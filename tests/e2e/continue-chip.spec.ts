import {
  type Browser,
  type BrowserContext,
  type CDPSession,
  expect,
  type Locator,
  type Page,
  test,
} from "@playwright/test";
import type { JSONContent } from "@tiptap/core";

import { expectNoSeriousA11yViolations, setTheme } from "./helpers/a11y";
import { EditorPage } from "./helpers/editor-page";
import { CHUNK_MARKERS, interceptChunk } from "./helpers/lazy-chunk";
import {
  activeOutlineRow,
  editorScrollTops,
  settledEditorScrollTop,
} from "./helpers/outline";

/**
 * "Continue where you left off" (spec M15): the chip offered on reopening
 * a document, back to the section the writer left.
 */

const KEY = "tinydocy-continue";
const CHIP = "[data-continue-chip]";

const heading = (text: string, level = 2): JSONContent => ({
  type: "heading",
  attrs: { level },
  content: [{ type: "text", text }],
});
const paragraph = (text: string): JSONContent => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});

/** Title, then `count` sections: "Section n", "Body n alpha", "Body n beta". */
function sectionsDoc(
  count: number,
  extra: (n: number) => JSONContent[] = () => [],
): JSONContent {
  const content: JSONContent[] = [heading("Continue test", 1)];
  for (let n = 1; n <= count; n++) {
    content.push(
      heading(`Section ${n}`),
      paragraph(`Body ${n} alpha`),
      paragraph(`Body ${n} beta`),
      ...extra(n),
    );
  }
  return { type: "doc", content };
}

const newDocId = () =>
  `continue-${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function open(page: Page, docId: string, content?: JSONContent) {
  const editor = new EditorPage(page);
  await editor.goto(docId);
  await editor.waitForSync();
  if (content) await editor.setContent(content);
  return editor;
}

/**
 * Puts the caret at the start of the block with `text`, as a click would (a
 * local selection change), with the text focused.
 */
async function placeCaret(page: Page, text: string) {
  await page.evaluate((name) => {
    const editor = window.__tiptap_editor;
    if (!editor) throw new Error("no editor");
    let pos = -1;
    editor.state.doc.descendants((node, offset) => {
      if (pos !== -1) return false;
      if (node.isTextblock && node.textContent === name) pos = offset + 1;
      return !node.isTextblock;
    });
    if (pos === -1) throw new Error(`no block "${name}"`);
    editor.commands.setTextSelection(pos);
    editor.view.focus();
  }, text);
}

const blurText = (page: Page) =>
  page.evaluate(() => (document.activeElement as HTMLElement).blur());

const storedFor = (page: Page, docId: string) =>
  page.evaluate(
    ([key, id]) => localStorage.getItem(key)?.includes(`"${id}"`) ?? false,
    [KEY, docId],
  );

/**
 * Puts the caret in the block with `text` and leaves the text (blur), until
 * the recorder (mounted on idle) has saved the place.
 */
async function leaveAt(page: Page, docId: string, text: string) {
  await expect
    .poll(
      async () => {
        // From the title first, so each try is a selection change.
        await placeCaret(page, "Continue test");
        await placeCaret(page, text);
        await blurText(page);
        return storedFor(page, docId);
      },
      { timeout: 20_000 },
    )
    .toBe(true);
}

async function reopen(page: Page, path = "/") {
  await page.goto(path);
  await new EditorPage(page).waitForSync();
}

const headingNamed = (page: Page, text: string, level = 2) =>
  page
    .locator(`.tiptap h${level}`)
    .filter({ hasText: new RegExp(`^${text}$`) });

/** The caret is at the end of the heading with `text`. */
const caretAtEndOf = (page: Page, text: string) =>
  page.evaluate((name) => {
    const editor = window.__tiptap_editor;
    if (!editor) return false;
    let end = -1;
    editor.state.doc.forEach((node, offset) => {
      if (node.type.name === "heading" && node.textContent === name) {
        end = offset + node.nodeSize - 1;
      }
    });
    const { selection } = editor.state;
    return selection.empty && selection.head === end;
  }, text);

const toolbarBottom = async (page: Page) => {
  const box = await page
    .locator(".document-editor-wrapper [role='toolbar']")
    .first()
    .boundingBox();
  return box ? box.y + box.height : 0;
};

/** The block's top is within 24px under the toolbar (2px of rounding). */
async function landedUnderToolbar(page: Page, target: Locator) {
  const box = await target.boundingBox();
  if (!box) return false;
  const offset = box.y - (await toolbarBottom(page));
  return offset >= -2 && offset <= 24;
}

const activeIsEditor = (page: Page) =>
  page.evaluate(() =>
    document.activeElement?.classList.contains("ProseMirror"),
  );

test.describe("continue where you left off", () => {
  test("offers the way back after reopening, never focused, and Go lands at the section", async ({
    page,
  }) => {
    const docId = newDocId();
    await open(page, docId, sectionsDoc(30));
    await leaveAt(page, docId, "Body 20 beta");
    await reopen(page);

    const chip = page.locator(CHIP);
    await expect(chip).toBeVisible({ timeout: 15_000 });
    await expect(chip).toContainText(
      "Continue where you left off · Section 20",
    );
    // Never focused; before the text in Tab order; outside the text.
    expect(
      await chip.evaluate((el) => el.contains(document.activeElement)),
    ).toBe(false);
    expect(
      await page.evaluate(
        () =>
          document
            .querySelector(".continue-chip-host")
            ?.nextElementSibling?.classList.contains("ProseMirror") ?? false,
      ),
    ).toBe(true);

    const go = chip.getByRole("button", { name: "Go to Section 20" });
    await go.click();
    await expect(chip).toHaveCount(0);
    expect(await caretAtEndOf(page, "Section 20")).toBe(true);
    expect(await activeIsEditor(page)).toBe(true);
    const target = headingNamed(page, "Section 20");
    await expect
      .poll(async () => landedUnderToolbar(page, target), { timeout: 6_000 })
      .toBe(true);
    // The outline follows: its active row (below the first screenful of
    // rows) is scrolled into view, without moving the page it landed on.
    const settled = await settledEditorScrollTop(page);
    await expect
      .poll(() => activeOutlineRow(page))
      .toEqual({ text: "Section 20", inView: true });
    await page.waitForTimeout(300);
    expect(new Set([settled, ...(await editorScrollTops(page))])).toEqual(
      new Set([settled]),
    );
    expect(await landedUnderToolbar(page, target)).toBe(true);
  });

  test("a heading inside a folded section is unfolded and lands at the top", async ({
    page,
  }) => {
    const docId = newDocId();
    await open(
      page,
      docId,
      sectionsDoc(30, (n) =>
        n === 19 ? [heading("Deep target", 3), paragraph("Deep body")] : [],
      ),
    );
    await leaveAt(page, docId, "Deep body");
    // Fold Section 19, which holds the place, then reopen.
    await page.evaluate(() => {
      const editor = window.__tiptap_editor;
      let id = "";
      editor?.state.doc.forEach((node) => {
        if (node.textContent === "Section 19") id = node.attrs["data-toc-id"];
      });
      editor?.commands.toggleFold(id);
    });
    await expect(headingNamed(page, "Section 19")).toHaveClass(
      /heading-section-folded/,
      { timeout: 5_000 },
    );
    await page.waitForTimeout(600); // the fold animation and its save
    await reopen(page);

    const chip = page.locator(CHIP);
    await expect(chip).toContainText("Deep target", { timeout: 15_000 });
    await expect(headingNamed(page, "Section 19")).toHaveClass(
      /heading-section-folded/,
    );
    await chip.getByRole("button", { name: "Go to Deep target" }).click();
    await expect(headingNamed(page, "Section 19")).not.toHaveClass(
      /heading-section-folded/,
    );
    expect(await caretAtEndOf(page, "Deep target")).toBe(true);
    const target = headingNamed(page, "Deep target", 3);
    await expect
      .poll(async () => landedUnderToolbar(page, target), { timeout: 6_000 })
      .toBe(true);
  });

  test("edits by a collaborator while away still land Go on the same section", async ({
    page,
    browser,
  }) => {
    const docId = newDocId();
    await open(page, docId, sectionsDoc(30));
    await leaveAt(page, docId, "Body 20 alpha");
    await page.goto("about:blank");

    // Another writer adds sections above and moves Section 20 to the end.
    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await open(otherPage, docId);
    await otherPage.evaluate(() => {
      const editor = window.__tiptap_editor;
      if (!editor) return;
      const title = editor.state.doc.firstChild?.nodeSize ?? 0;
      editor.commands.insertContentAt(
        title,
        Array.from({ length: 10 }, (_, i) => ({
          type: "paragraph",
          content: [{ type: "text", text: `Inserted ${i}` }],
        })),
      );
      // Cut Section 20 (heading and both bodies) and paste it at the end.
      const { doc } = editor.state;
      let from = -1;
      let to = -1;
      doc.forEach((node, offset) => {
        if (node.textContent === "Section 20") from = offset;
        if (node.textContent === "Body 20 beta") to = offset + node.nodeSize;
      });
      const slice = doc.slice(from, to);
      editor.chain().deleteRange({ from, to }).run();
      editor.commands.insertContentAt(
        editor.state.doc.content.size,
        slice.content.toJSON(),
      );
    });
    await expect(otherPage.locator(".tiptap h2").last()).toHaveText(
      "Section 20",
    );
    await otherPage.waitForTimeout(1_000);
    await other.close();

    await page.goto("/");
    await new EditorPage(page).waitForSync();
    const chip = page.locator(CHIP);
    await expect(chip).toContainText("Section 20", { timeout: 15_000 });
    await chip.getByRole("button", { name: "Go to Section 20" }).click();
    expect(await caretAtEndOf(page, "Section 20")).toBe(true);
    await expect(headingNamed(page, "Section 20")).toBeInViewport();
  });

  test("the chip moves nothing when it appears or goes", async ({ page }) => {
    const docId = newDocId();
    await open(page, docId, sectionsDoc(30));
    await leaveAt(page, docId, "Body 20 beta");
    await page.addInitScript(() => {
      const shifts: { value: number; time: number }[] = [];
      (window as unknown as { __shifts: typeof shifts }).__shifts = shifts;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as (PerformanceEntry & {
          value: number;
          hadRecentInput: boolean;
        })[]) {
          if (!entry.hadRecentInput) {
            shifts.push({ value: entry.value, time: entry.startTime });
          }
        }
      }).observe({ type: "layout-shift", buffered: true });
    });
    await reopen(page);
    const chip = page.locator(CHIP);
    await expect(chip).toBeVisible({ timeout: 15_000 });

    const layout = () =>
      page.evaluate(() => {
        const title = document.querySelector(".tiptap > h1");
        const text = document.querySelector(".tiptap");
        return [
          title?.getBoundingClientRect().top,
          text?.getBoundingClientRect().top,
          document.querySelector(".document-editor-wrapper")?.scrollHeight,
        ];
      });
    const withChip = await layout();
    const shiftsAt = () =>
      page.evaluate(
        () =>
          (window as unknown as { __shifts: { value: number }[] }).__shifts
            .length,
      );
    const before = await shiftsAt();
    await chip.getByRole("button", { name: "Dismiss" }).click();
    await expect(chip).toHaveCount(0);
    await page.waitForTimeout(500);
    expect(await layout()).toEqual(withChip);
    expect(await shiftsAt()).toBe(before);
  });

  test("Dismiss and Esc put focus in the text and keep its selection; the first input dismisses", async ({
    page,
  }) => {
    const docId = newDocId();
    await open(page, docId, sectionsDoc(30));
    await leaveAt(page, docId, "Body 20 beta");
    const chip = page.locator(CHIP);
    const head = () =>
      page.evaluate(() => window.__tiptap_editor?.state.selection.head);

    // Esc on the Go button.
    await reopen(page);
    await expect(chip).toBeVisible({ timeout: 15_000 });
    const start = await head();
    await chip.getByRole("button", { name: /^Go to/ }).focus();
    await page.keyboard.press("Escape");
    await expect(chip).toHaveCount(0);
    expect(await activeIsEditor(page)).toBe(true);
    expect(await head()).toBe(start);

    // Dismiss with the keyboard.
    await reopen(page);
    await expect(chip).toBeVisible({ timeout: 15_000 });
    await chip.getByRole("button", { name: "Dismiss" }).focus();
    await page.keyboard.press("Enter");
    await expect(chip).toHaveCount(0);
    expect(await activeIsEditor(page)).toBe(true);

    // A click in the text dismisses it, and the dismissal sticks.
    await reopen(page);
    await expect(chip).toBeVisible({ timeout: 15_000 });
    await page.locator(".tiptap > h1").click();
    await expect(chip).toHaveCount(0);
    await page.keyboard.type("!");
    await page.waitForTimeout(500);
    await expect(chip).toHaveCount(0);
  });

  test("no chip near the top, in playground, or before the server sync", async ({
    page,
  }) => {
    const docId = newDocId();
    await open(page, docId, sectionsDoc(30));
    await leaveAt(page, docId, "Body 20 beta");
    // A caret in Section 1 (the second block) deletes the place.
    await placeCaret(page, "Body 1 alpha");
    await blurText(page);
    expect(await storedFor(page, docId)).toBe(false);
    await reopen(page);
    await page.waitForTimeout(3_000);
    await expect(page.locator(CHIP)).toHaveCount(0);

    // Playground: regenerated content, never offered.
    await page.evaluate(
      ([key, now]) =>
        localStorage.setItem(
          key,
          JSON.stringify({
            v: 1,
            docs: { playground: { id: "anything", at: now } },
          }),
        ),
      [KEY, Date.now()] as const,
    );
    await new EditorPage(page).goto("playground");
    await page.waitForTimeout(3_000);
    await expect(page.locator(CHIP)).toHaveCount(0);
  });

  test("offline: the device copy opens, but no chip until the server answers", async ({
    page,
    context,
  }) => {
    const docId = newDocId();
    await open(page, docId, sectionsDoc(30));
    await leaveAt(page, docId, "Body 20 beta");
    await page.waitForTimeout(1_500); // the offline copy's debounce
    await context.routeWebSocket(
      (url) => !url.pathname.startsWith("/_next"),
      (ws) => void ws.close(),
    );
    await page.reload();
    await expect(page.locator(".tiptap")).toContainText("Body 20 beta", {
      timeout: 15_000,
    });
    await page.waitForTimeout(3_000);
    await expect(page.locator(CHIP)).toHaveCount(0);
  });

  test("a continue chunk that fails to load leaves the editor working", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const stop = await interceptChunk(
      page,
      CHUNK_MARKERS.continueChip,
      (route) => route.abort(),
    );
    const docId = newDocId();
    await open(page, docId, sectionsDoc(5));
    await page.waitForTimeout(2_000);
    await page.locator(".tiptap").getByText("Body 3 beta").click();
    await page.keyboard.press("End");
    await page.keyboard.type(" still typing");
    await expect(page.locator(".tiptap")).toContainText(
      "Body 3 beta still typing",
    );
    await page.locator('[data-tab-id="playground"]').click();
    await expect(page.locator(".tiptap")).toBeVisible();
    await expect(page.locator(CHIP)).toHaveCount(0);
    await stop();
    expect(errors).toEqual([]);
  });

  test("axe: no serious issue in light and dark; forced colours keep a border", async ({
    browser,
  }) => {
    for (const theme of ["light", "dark"] as const) {
      const context = await browser.newContext();
      const page = await context.newPage();
      await setTheme(page, theme);
      const docId = newDocId();
      await open(page, docId, sectionsDoc(30));
      await leaveAt(page, docId, "Body 20 beta");
      await reopen(page);
      await expect(page.locator(CHIP)).toBeVisible({ timeout: 15_000 });
      await expectNoSeriousA11yViolations(page, [CHIP]);
      if (theme === "light") {
        await page.emulateMedia({ forcedColors: "active" });
        const border = await page
          .locator(CHIP)
          .evaluate((el) => getComputedStyle(el).borderTopStyle);
        expect(border).toBe("solid");
      }
      await context.close();
    }
  });
});

test.describe("continue where you left off: phone", () => {
  async function phone(browser: Browser): Promise<[BrowserContext, Page]> {
    const context = await browser.newContext({
      viewport: { width: 375, height: 812 },
      hasTouch: true,
      isMobile: true,
    });
    return [context, await context.newPage()];
  }

  /**
   * A touch pan is reading, not choosing a place: the chip stays. Raw
   * touch events (CDP's synthesized scroll gesture does not scroll on
   * headless Linux); the pan must reach the page as a pointerdown, the
   * event that used to dismiss the chip, and ends without a click.
   */
  async function panKeepsChip(context: BrowserContext, page: Page) {
    const scroller = page.locator("main.document-editor-wrapper");
    const scrollTop = () => scroller.evaluate((el) => el.scrollTop);
    const cdp = await context.newCDPSession(page);
    await page.evaluate(() => {
      const w = window as unknown as { __downs: number };
      w.__downs = 0;
      document.addEventListener("pointerdown", () => w.__downs++, true);
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: 180, y: 450 }],
    });
    for (let y = 420; y >= 150; y -= 30) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: 180, y }],
      });
    }
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    expect(
      await page.evaluate(
        () => (window as unknown as { __downs: number }).__downs,
      ),
    ).toBeGreaterThan(0);
    expect(await scrollTop()).toBeGreaterThan(0);
    // The pan leaves the page coasting. A tap that stops a coasting page
    // only stops it, as on any phone (Chromium on Linux drops the click),
    // so tap once the page is at rest.
    let last = -1;
    await expect
      .poll(
        async () => {
          const top = await scrollTop();
          const still = top === last;
          last = top;
          return still;
        },
        { intervals: [250] },
      )
      .toBe(true);
  }

  test("375px touch: above the connection chip and the bar, 44px targets, no sideways scroll", async ({
    browser,
    browserName,
  }) => {
    const [context, page] = await phone(browser);
    expect(
      await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
    ).toBe(true);
    const docId = newDocId();
    await open(page, docId, sectionsDoc(30));
    await leaveAt(page, docId, "Body 20 beta");
    await reopen(page);

    const chip = page.locator(CHIP);
    await expect(chip).toBeVisible({ timeout: 15_000 });
    const box = await chip.boundingBox();
    const status = await page.locator("[data-collab-status]").boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(375);
    if (status) expect(box.y + box.height).toBeLessThanOrEqual(status.y);
    for (const name of [/^Go to/, /^Dismiss$/]) {
      const target = await chip.getByRole("button", { name }).boundingBox();
      expect(target?.width).toBeGreaterThanOrEqual(44);
      expect(target?.height).toBeGreaterThanOrEqual(44);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);

    // The section name is not cut: phones drop "where you left off".
    await expect(chip).toContainText("Continue · Section 20", {
      useInnerText: true,
    });

    // Raw touch events go through Chromium's DevTools protocol.
    if (browserName === "chromium") await panKeepsChip(context, page);
    await expect(chip).toBeVisible();

    await chip.getByRole("button", { name: /^Go to/ }).tap();
    await expect(chip).toHaveCount(0);
    expect(await caretAtEndOf(page, "Section 20")).toBe(true);
    await expect(headingNamed(page, "Section 20")).toBeInViewport();

    // A tap on Dismiss does not focus the text (no keyboard for nothing).
    await reopen(page);
    await expect(chip).toBeVisible({ timeout: 15_000 });
    await chip.getByRole("button", { name: "Dismiss" }).tap();
    await expect(chip).toHaveCount(0);
    expect(await activeIsEditor(page)).toBe(false);
    await context.close();
  });
});

test.describe("continue where you left off: hygiene", () => {
  // Listener counts come from Chromium's DevTools protocol.
  test.skip(({ browserName }) => browserName !== "chromium", "CDP only");

  async function listeners(cdp: CDPSession) {
    const count = async (expression: string) => {
      const { result } = await cdp.send("Runtime.evaluate", {
        expression,
        objectGroup: "continue-leaks",
      });
      const { listeners } = await cdp.send("DOMDebugger.getEventListeners", {
        objectId: result.objectId as string,
      });
      await cdp.send("Runtime.releaseObjectGroup", {
        objectGroup: "continue-leaks",
      });
      return listeners.length;
    };
    return { window: await count("window"), document: await count("document") };
  }

  test("20 tab switches with the chip mounted return window and document listeners to baseline", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const docId = newDocId();
    await open(page, docId, sectionsDoc(30));
    await leaveAt(page, docId, "Body 20 beta");
    const cdp = await page.context().newCDPSession(page);
    const switchTo = async (id: string) => {
      await page.locator(`[data-tab-id="${id}"]`).click();
      await page.waitForSelector(".tiptap[contenteditable='true']");
    };
    // Warm up both tabs and their chips.
    await switchTo("playground");
    await switchTo(docId);
    await switchTo("playground");
    await switchTo(docId);
    await page.waitForTimeout(2_000);
    const baseline = await listeners(cdp);
    for (let i = 0; i < 20; i++) {
      await switchTo(i % 2 === 0 ? "playground" : docId);
    }
    await page.waitForTimeout(2_000);
    expect(await listeners(cdp)).toEqual(baseline);
  });

  test("kill switch: no chip and no stored place", async ({ page }) => {
    test.skip(
      process.env.E2E_REMEMBER_OFF !== "1",
      "needs a Next started with NEXT_PUBLIC_REMEMBER_CHOICES=0",
    );
    const docId = newDocId();
    await open(page, docId, sectionsDoc(30));
    await placeCaret(page, "Body 20 beta");
    await blurText(page);
    await page.waitForTimeout(3_000);
    await placeCaret(page, "Body 21 beta");
    await blurText(page);
    expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBe(
      null,
    );
    await reopen(page);
    await page.waitForTimeout(3_000);
    await expect(page.locator(CHIP)).toHaveCount(0);
  });
});
