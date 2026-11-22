/**
 * The on-screen keyboard, measured once for the page (phones and tablets
 * design §4.6, PR M20): `--keyboard-inset` on `<html>`, bottom sheets ride
 * it, one `visualViewport` listener set that leaves with its last
 * subscriber, and the caret back in view after a rotation. Chromium has no
 * on-screen keyboard, so a shrunken `visualViewport` stands in for it; the
 * real keyboards are the owner's device checks (M18).
 */
import { type CDPSession, expect, type Page, test } from "@playwright/test";

import { openToolbarTestDoc, setTheme } from "./helpers/a11y";

const PHONE = { width: 390, height: 844 };
const KEYBOARD = 300;
const SCREENS = "docs/design/m20-keyboard-inset";

test.use({ hasTouch: true, isMobile: true, viewport: PHONE });

/** The phone bar, not the row toolbar that replaces it from 768px. */
const bar = (page: Page) => page.locator("[data-mobile-bar]");
const sheet = (page: Page) => page.getByRole("dialog", { name: "Text format" });

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

async function openSheet(page: Page) {
  await bar(page).getByRole("button", { name: "Text format" }).tap();
  await expect(sheet(page)).toBeVisible();
  await sheet(page).getByRole("button", { name: "Heading 1" }).waitFor();
  await sheet(page).evaluate((el) =>
    Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)),
  );
}

/**
 * Stands in for the keyboard: the visual viewport loses `keyboard` px and,
 * like iOS bringing a field into view, can be scrolled `offsetTop` down.
 */
async function showKeyboard(page: Page, keyboard: number, offsetTop = 0) {
  await page.evaluate(
    ([height, top]) => {
      const vv = window.visualViewport;
      if (!vv) throw new Error("no visualViewport");
      Object.defineProperty(vv, "height", {
        configurable: true,
        get: () => window.innerHeight - height,
      });
      Object.defineProperty(vv, "offsetTop", {
        configurable: true,
        get: () => top,
      });
      vv.dispatchEvent(new Event("resize"));
      vv.dispatchEvent(new Event("scroll"));
    },
    [keyboard, offsetTop] as const,
  );
}

const htmlVar = (page: Page, name: string) =>
  page.evaluate(
    (prop) => document.documentElement.style.getPropertyValue(prop),
    name,
  );

const sheetBox = async (page: Page) => {
  const box = await sheet(page).boundingBox();
  if (!box) throw new Error("sheet not laid out");
  return { top: Math.round(box.y), bottom: Math.round(box.y + box.height) };
};

test("a bottom sheet rides the keyboard and fits the visual viewport", async ({
  page,
}) => {
  await openDoc(page);
  await openSheet(page);
  // Keyboard down: the sheet sits on the bottom edge, as before.
  expect((await sheetBox(page)).bottom).toBe(PHONE.height);

  await showKeyboard(page, KEYBOARD);
  await expect.poll(() => htmlVar(page, "--keyboard-inset")).toBe("300px");
  expect(await htmlVar(page, "--visual-viewport-height")).toBe("544px");
  await expect
    .poll(async () => (await sheetBox(page)).bottom)
    .toBe(PHONE.height - KEYBOARD);
  expect((await sheetBox(page)).top).toBeGreaterThanOrEqual(0);

  // iOS scrolls the visual viewport to the field: the sheet follows it and
  // stays inside it.
  await showKeyboard(page, KEYBOARD, 100);
  await expect.poll(() => htmlVar(page, "--keyboard-inset")).toBe("200px");
  await expect
    .poll(async () => (await sheetBox(page)).bottom)
    .toBe(PHONE.height - 200);
  expect((await sheetBox(page)).top).toBeGreaterThanOrEqual(100);
});

test.describe("one listener set (leak spec)", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "CDP only");

  async function viewportListeners(cdp: CDPSession) {
    const { result } = await cdp.send("Runtime.evaluate", {
      expression: "window.visualViewport",
      objectGroup: "keyboard-inset",
    });
    const { listeners } = await cdp.send("DOMDebugger.getEventListeners", {
      objectId: result.objectId as string,
    });
    await cdp.send("Runtime.releaseObjectGroup", {
      objectGroup: "keyboard-inset",
    });
    // The store's own pair (`next dev` keeps source names); Floating UI's
    // autoUpdate adds its own while a popover of the row toolbar is open.
    return listeners
      .filter((listener) => listener.handler?.description?.includes("settle"))
      .map((listener) => listener.type)
      .sort();
  }

  test("is shared by the bar and the sheet, and leaves with them", async ({
    page,
  }) => {
    await openDoc(page);
    const cdp = await page.context().newCDPSession(page);
    expect(await viewportListeners(cdp)).toEqual(["resize", "scroll"]);
    await openSheet(page);
    expect(await viewportListeners(cdp)).toEqual(["resize", "scroll"]);
    await page.keyboard.press("Escape");
    await expect(sheet(page)).toBeHidden();

    for (let i = 0; i < 5; i++) {
      // Wider than 768px: the row toolbar replaces the bar.
      await page.setViewportSize({ width: 1024, height: 768 });
      await expect(bar(page)).toBeHidden();
      await expect.poll(() => viewportListeners(cdp)).toEqual([]);
      expect(await htmlVar(page, "--keyboard-inset")).toBe("");
      expect(await htmlVar(page, "--visual-viewport-height")).toBe("");
      await page.setViewportSize(PHONE);
      await expect(bar(page)).toBeVisible();
      await expect
        .poll(() => viewportListeners(cdp))
        .toEqual(["resize", "scroll"]);
    }
  });
});

/** Long paragraphs, so a narrower page wraps them onto many more lines. */
async function fillAndPlaceCaret(page: Page, paragraphs: number, at: number) {
  await page.evaluate(
    ([count, index]) => {
      const editor = window.__tiptap_editor;
      if (!editor) throw new Error("editor missing");
      const text =
        "The keyboard covers half the phone, so the caret must stay in view while the page turns. ";
      const content = Array.from({ length: count }, (_, i) => ({
        type: "paragraph",
        content: [{ type: "text", text: `${i}: ${text.repeat(3)}` }],
      }));
      editor.commands.insertContentAt(editor.state.doc.content.size, content);
      let pos = 0;
      let seen = -1;
      editor.state.doc.forEach((node, offset) => {
        if (node.type.name !== "paragraph" || !node.textContent) return;
        seen += 1;
        if (seen === index) pos = offset + 1 + 20;
      });
      editor.chain().focus().setTextSelection(pos).scrollIntoView().run();
    },
    [paragraphs, at] as const,
  );
}

/** The caret's top and bottom in the viewport, and the space left for it. */
const caretPlace = (page: Page) =>
  page.evaluate(() => {
    const editor = window.__tiptap_editor;
    if (!editor) throw new Error("editor missing");
    const coords = editor.view.coordsAtPos(editor.state.selection.head);
    const barEl = document.querySelector<HTMLElement>("[data-mobile-bar]");
    const floor = barEl?.checkVisibility()
      ? barEl.getBoundingClientRect().top
      : window.innerHeight;
    return {
      top: coords.top,
      bottom: coords.bottom,
      floor,
      focused: editor.view.hasFocus(),
    };
  });

async function expectCaretInView(page: Page) {
  await expect
    .poll(async () => {
      const place = await caretPlace(page);
      return place.focused && place.top >= 0 && place.bottom <= place.floor;
    })
    .toBe(true);
}

test("the caret comes back into view after a rotation below 768px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 667, height: 375 }); // iPhone SE, landscape
  await openDoc(page);
  await fillAndPlaceCaret(page, 24, 12);
  await expectCaretInView(page);
  await page.setViewportSize({ width: 375, height: 667 });
  await expectCaretInView(page);
  await page.setViewportSize({ width: 667, height: 375 });
  await expectCaretInView(page);
});

test("the caret comes back into view after a rotation across 768px", async ({
  page,
}) => {
  await openDoc(page);
  await fillAndPlaceCaret(page, 24, 12);
  await expectCaretInView(page);
  // Landscape: the row toolbar replaces the bar.
  await page.setViewportSize({ width: PHONE.height, height: PHONE.width });
  await expect(bar(page)).toBeHidden();
  await expectCaretInView(page);
  await page.setViewportSize(PHONE);
  await expect(bar(page)).toBeVisible();
  await expectCaretInView(page);
});

test("scrolling the caret back adds no undo step and no Yjs update", async ({
  page,
}) => {
  await page.setViewportSize({ width: 667, height: 375 });
  await openDoc(page);
  await fillAndPlaceCaret(page, 12, 6);
  const before = await page.evaluate(() =>
    JSON.stringify(window.__tiptap_editor?.getJSON()),
  );
  await page.evaluate(() => {
    const editor = window.__tiptap_editor;
    (window as { __m20Steps?: number }).__m20Steps = 0;
    editor?.on("transaction", ({ transaction }) => {
      const w = window as { __m20Steps?: number };
      w.__m20Steps = (w.__m20Steps ?? 0) + transaction.steps.length;
    });
  });
  await page.setViewportSize({ width: 375, height: 667 });
  await expectCaretInView(page);
  expect(
    await page.evaluate(() => (window as { __m20Steps?: number }).__m20Steps),
  ).toBe(0);
  expect(
    await page.evaluate(() =>
      JSON.stringify(window.__tiptap_editor?.getJSON()),
    ),
  ).toBe(before);
});

for (const theme of ["light", "dark"] as const) {
  test(`screenshots: the sheet on the keyboard (${theme})`, async ({
    page,
  }) => {
    test.skip(
      !process.env.M20_SCREENS,
      "design evidence: M20_SCREENS=1 writes docs/design screenshots",
    );
    await setTheme(page, theme);
    await openDoc(page);
    await openSheet(page);
    await page.screenshot({
      path: `${SCREENS}/sheet-keyboard-down-${theme}.png`,
    });
    await showKeyboard(page, KEYBOARD);
    await expect
      .poll(async () => (await sheetBox(page)).bottom)
      .toBe(PHONE.height - KEYBOARD);
    // Paint the stand-in keyboard, so the picture shows what it covers.
    await page.addStyleTag({
      content: `html::after { content: "on-screen keyboard (stand-in)"; position: fixed; inset: auto 0 0 0; height: ${KEYBOARD}px; display: grid; place-items: center; background: #8e8e93; color: #fff; font: 14px system-ui; z-index: 2147483647; }`,
    });
    await page.screenshot({
      path: `${SCREENS}/sheet-keyboard-up-${theme}.png`,
    });
  });
}

test.describe("desktop", () => {
  test.use({
    hasTouch: false,
    isMobile: false,
    viewport: { width: 1180, height: 820 },
  });

  for (const theme of ["light", "dark"] as const) {
    test(`nothing subscribes and nothing moves at 1180px (${theme})`, async ({
      page,
    }) => {
      await setTheme(page, theme);
      await openToolbarTestDoc(page);
      await expect(bar(page)).toBeHidden();
      expect(await htmlVar(page, "--keyboard-inset")).toBe("");
      if (!process.env.M20_SCREENS) return;
      await page.addStyleTag({
        content: "nextjs-portal { display: none !important; }",
      });
      await page.screenshot({ path: `${SCREENS}/desktop-1180-${theme}.png` });
    });
  }
});
