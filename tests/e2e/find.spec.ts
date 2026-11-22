import { expect, type Page, test } from "@playwright/test";
import type { JSONContent } from "@tiptap/core";

import { expectNoSeriousA11yViolations, setTheme } from "./helpers/a11y";
import { EditorPage } from "./helpers/editor-page";

/**
 * Find and replace in the document (P2.11, details spec E1): the lazy find
 * bar on ⌘F / Ctrl+F, hits painted with the CSS Custom Highlight API.
 */

const BAR = "[data-find-bar]";
const FIND_INPUT = `${BAR} input[aria-label="Find in document"]`;
const REPLACE_INPUT = `${BAR} input[aria-label="Replace with"]`;
const STATUS = `${BAR} [role="status"]`;
/** Design-review screenshots, committed with the PR (`FIND_SCREENSHOTS=1`). */
const SCREENS = "docs/design/2026-11-22-p2-11-find";
const screenshots = process.env.FIND_SCREENSHOTS === "1";

const heading = (text: string, level = 2): JSONContent => ({
  type: "heading",
  attrs: { level },
  content: [{ type: "text", text }],
});
const paragraph = (text: string): JSONContent => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});

function sectionsDoc(count: number): JSONContent {
  const content: JSONContent[] = [heading("Find test", 1)];
  for (let n = 1; n <= count; n++) {
    content.push(
      heading(`Section ${n} needle`),
      paragraph(`Body ${n} has a needle and a pin.`),
      paragraph(`More text for section ${n}.`),
    );
  }
  return { type: "doc", content };
}

async function open(page: Page, content: JSONContent): Promise<EditorPage> {
  const editor = new EditorPage(page);
  await editor.goto();
  await editor.waitForSync();
  await editor.setContent(content);
  await editor.expectSavedToServer();
  // Next's dev indicator is not part of the screenshots under review.
  await page.addStyleTag({
    content: "nextjs-portal { display: none !important; }",
  });
  await editor.focusTitle();
  return editor;
}

async function openFind(page: Page) {
  await page.keyboard.press("ControlOrMeta+f");
  await expect(page.locator(FIND_INPUT)).toBeFocused();
}

/** Text under each range of a highlight, in document order. */
const highlighted = (page: Page, name: string) =>
  page.evaluate((key) => {
    const highlight = CSS.highlights.get(key);
    return highlight
      ? [...highlight].map((range) => (range as Range).toString())
      : null;
  }, name);

const docText = (page: Page) =>
  page.evaluate(() => window.__tiptap_editor?.state.doc.textContent ?? "");

test.describe("Find in the document", () => {
  test("finds, steps, closes onto the hit, and never counts the outline", async ({
    page,
  }) => {
    await open(page, sectionsDoc(3));
    // The outline lists "Section n needle" too; Find counts the text only.
    await openFind(page);
    await page.keyboard.type("needle");
    await expect(page.locator(STATUS)).toHaveText("1 of 6");
    await expect.poll(() => highlighted(page, "tinydocy-find")).toHaveLength(6);
    expect(await highlighted(page, "tinydocy-find-current")).toEqual([
      "needle",
    ]);
    await page.keyboard.press("Enter");
    await expect(page.locator(STATUS)).toHaveText("2 of 6");
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.press("Shift+Enter");
    await expect(page.locator(STATUS)).toHaveText("6 of 6");
    // ⌘G / Ctrl+G from the field steps too.
    await page.keyboard.press("ControlOrMeta+g");
    await expect(page.locator(STATUS)).toHaveText("1 of 6");

    await page.keyboard.press("Escape");
    await expect(page.locator(BAR)).toHaveCount(0);
    expect(await highlighted(page, "tinydocy-find")).toBeNull();
    const selected = await page.evaluate(() => {
      const editor = window.__tiptap_editor;
      if (!editor) return null;
      const { from, to } = editor.state.selection;
      return {
        text: editor.state.doc.textBetween(from, to),
        focused: editor.view.hasFocus(),
      };
    });
    expect(selected).toEqual({ text: "needle", focused: true });

    // ⌘G with the bar closed reopens it on the last query.
    await page.keyboard.press("ControlOrMeta+g");
    await expect(page.locator(FIND_INPUT)).toHaveValue("needle");
  });

  test("options: match case and whole word", async ({ page }) => {
    await open(page, {
      type: "doc",
      content: [heading("Options", 1), paragraph("Cat cat concat cats")],
    });
    await openFind(page);
    await page.keyboard.type("cat");
    await expect(page.locator(STATUS)).toHaveText("1 of 4");
    await page.getByRole("button", { name: "Match case" }).click();
    await expect(page.locator(STATUS)).toHaveText("1 of 3");
    await page.getByRole("button", { name: "Whole word" }).click();
    await expect(page.locator(STATUS)).toHaveText("1 of 1");
    await page.locator(FIND_INPUT).fill("dog");
    await expect(page.locator(STATUS)).toHaveText("No results");
    // Esc closes from a button too.
    await page.getByRole("button", { name: "Whole word" }).focus();
    await page.keyboard.press("Escape");
    await expect(page.locator(BAR)).toHaveCount(0);
  });

  test("replaces one hit, then all of them in one undo step", async ({
    page,
  }) => {
    await open(page, {
      type: "doc",
      content: [
        heading("Colour chart", 1),
        paragraph("colour one, colour two"),
        paragraph("COLOUR three"),
      ],
    });
    await openFind(page);
    await page.keyboard.type("colour");
    // The caret is at the end of the title: the first hit after it.
    await expect(page.locator(STATUS)).toHaveText("2 of 4");
    await page
      .getByRole("button", { name: "Replace", exact: true })
      .first()
      .click();
    await page.locator(REPLACE_INPUT).fill("color");
    await page.locator(REPLACE_INPUT).press("Enter");
    // The next hit after the replacement ("colour two") is current.
    await expect(page.locator(STATUS)).toHaveText("2 of 3");
    expect(await docText(page)).toBe(
      "Colour chartcolor one, colour twoCOLOUR three",
    );
    // Past Yjs's undo capture window, so Replace all is its own step.
    await page.waitForTimeout(700);
    await page.getByRole("button", { name: "Replace all" }).click();
    await expect(page.locator(STATUS)).toHaveText("Replaced 3");
    expect(await docText(page)).toBe(
      "color chartcolor one, color twocolor three",
    );
    await expect(page.locator(REPLACE_INPUT)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.locator(BAR)).toHaveCount(0);
    await page.keyboard.press("ControlOrMeta+z");
    await expect
      .poll(() => docText(page))
      .toBe("Colour chartcolor one, colour twoCOLOUR three");
  });

  test("follows a collaborator's edits while open", async ({ browser }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    const docId = `find-collab-${Date.now()}`;
    const editorA = new EditorPage(pageA);
    await editorA.goto(docId);
    await editorA.waitForSync();
    await editorA.setContent(sectionsDoc(2));
    await editorA.expectSavedToServer();
    const editorB = new EditorPage(pageB);
    await editorB.goto(docId);
    await editorB.waitForSync();
    await expect.poll(() => docText(pageB)).toContain("Body 2 has a needle");

    await editorA.focusTitle();
    await openFind(pageA);
    await pageA.keyboard.type("needle");
    await expect(pageA.locator(STATUS)).toHaveText("1 of 4");

    await pageB.evaluate(() => {
      const editor = window.__tiptap_editor;
      if (!editor) throw new Error("no editor");
      editor.commands.insertContentAt(
        editor.state.doc.content.size - 1,
        " needle",
      );
    });
    await expect(pageA.locator(STATUS)).toHaveText("1 of 5");
    await expect
      .poll(() => highlighted(pageA, "tinydocy-find"))
      .toEqual(["needle", "needle", "needle", "needle", "needle"]);
    // Focus stayed in the find field.
    await expect(pageA.locator(FIND_INPUT)).toBeFocused();
    await contextA.close();
    await contextB.close();
  });

  test("right-to-left text and Arabic letter forms", async ({ page }) => {
    await open(page, {
      type: "doc",
      content: [heading("کتاب‌ها", 1), paragraph("این كتاب خوب است. کتاب دوم.")],
    });
    await openFind(page);
    await page.keyboard.type("کتاب");
    // Arabic كتاب and Persian کتاب, and the title's "کتاب" inside "کتاب‌ها";
    // the caret is at the end of the title, so the first hit after it is 2.
    await expect(page.locator(STATUS)).toHaveText("2 of 3");
    await page.getByRole("button", { name: "Whole word" }).click();
    await expect(page.locator(STATUS)).toHaveText("1 of 2");
    await expect
      .poll(() => highlighted(page, "tinydocy-find"))
      .toEqual(["كتاب", "کتاب"]);
    if (screenshots) {
      await page.screenshot({ path: `${SCREENS}/find-rtl.png` });
    }
  });

  test("composition in the editor is untouched while Find is open", async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "CDP IME input");
    await open(page, sectionsDoc(1));
    await openFind(page);
    await page.keyboard.type("needle");
    await expect(page.locator(STATUS)).toHaveText("1 of 2");
    // Back into the body text; compose "日本" with an IME.
    await page.evaluate(() => {
      const editor = window.__tiptap_editor;
      if (!editor) throw new Error("no editor");
      editor.commands.setTextSelection(editor.state.doc.content.size - 1);
      editor.view.focus();
    });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.imeSetComposition", {
      text: "にほ",
      selectionStart: 2,
      selectionEnd: 2,
    });
    await cdp.send("Input.imeSetComposition", {
      text: "日本",
      selectionStart: 2,
      selectionEnd: 2,
    });
    await cdp.send("Input.insertText", { text: "日本" });
    await expect.poll(() => docText(page)).toContain("section 1.日本");
    await page.keyboard.type(" needle");
    await expect(page.locator(STATUS)).toHaveText(/of 3$/);
  });

  test("1,000 headings: typing and stepping with Find open stay fast", async ({
    page,
  }) => {
    test.slow();
    await open(page, sectionsDoc(1000));
    // Median time of 40 one-character transactions in the body.
    const typingMs = () =>
      page.evaluate(() => {
        const editor = window.__tiptap_editor;
        if (!editor) throw new Error("no editor");
        const { doc } = editor.state;
        // Inside "Body 1 has a needle…".
        const at = doc.child(0).nodeSize + doc.child(1).nodeSize + 4;
        const times: number[] = [];
        for (let i = 0; i < 40; i++) {
          const start = performance.now();
          editor.view.dispatch(
            editor.state.tr.insertText(i % 2 ? "e" : "n", at),
          );
          times.push(performance.now() - start);
        }
        times.sort((a, b) => a - b);
        return times[Math.floor(times.length / 2)];
      });
    const closed = await typingMs();

    await openFind(page);
    await page.keyboard.type("needle");
    await expect(page.locator(STATUS)).toHaveText("1 of 2,000");

    // Stepping: each Enter updates the count within a frame or two.
    const stepStart = Date.now();
    for (let i = 0; i < 20; i++) await page.keyboard.press("Enter");
    await expect(page.locator(STATUS)).toHaveText("21 of 2,000");
    const stepMs = (Date.now() - stepStart) / 20;

    const opened = await typingMs();
    test.info().annotations.push({
      type: "perf",
      description: `step ${stepMs.toFixed(1)} ms/Enter; transaction median ${closed.toFixed(2)} ms closed, ${opened.toFixed(2)} ms with Find open`,
    });
    // Find rescans one block per keystroke, never the document.
    expect(opened - closed).toBeLessThan(4);
    expect(stepMs).toBeLessThan(250);
  });

  test("axe and design screenshots", async ({ page }) => {
    for (const theme of ["light", "dark"] as const) {
      await setTheme(page, theme);
      await open(page, sectionsDoc(6));
      await openFind(page);
      await page.keyboard.type("needle");
      await page.keyboard.press("Enter");
      await expect(page.locator(STATUS)).toHaveText("2 of 12");
      await expectNoSeriousA11yViolations(page, [BAR]);
      if (screenshots) {
        await page.screenshot({ path: `${SCREENS}/find-${theme}.png` });
      }
      await page
        .getByRole("button", { name: "Replace", exact: true })
        .first()
        .click();
      await page.locator(REPLACE_INPUT).fill("pin");
      await expectNoSeriousA11yViolations(page, [BAR]);
      if (screenshots) {
        await page.screenshot({ path: `${SCREENS}/replace-${theme}.png` });
      }
      await page.locator(FIND_INPUT).fill("haystack");
      await expect(page.locator(STATUS)).toHaveText("No results");
      if (screenshots && theme === "light") {
        await page.screenshot({ path: `${SCREENS}/no-results-light.png` });
      }
    }
  });

  test("phone width: the bar sits above the phone bar", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, sectionsDoc(4));
    await openFind(page);
    await page.keyboard.type("needle");
    await expect(page.locator(STATUS)).toHaveText("1 of 8");
    const [bar, toolbar] = await Promise.all([
      page.locator(BAR).boundingBox(),
      page.locator('[role="toolbar"]').first().boundingBox(),
    ]);
    expect(bar && toolbar && bar.y + bar.height <= toolbar.y + 1).toBe(true);
    if (screenshots) {
      await page.screenshot({ path: `${SCREENS}/find-phone.png` });
    }
  });
});
