/**
 * Selection bubble (spec §4.3, D2 plan task 5): desktop only. B · I · U │
 * text colour split │ link; every action is also in the row.
 */
import { mkdirSync } from "node:fs";

import { expect, type Locator, type Page, test } from "@playwright/test";

import { BUBBLE_ACTION_IDS } from "@/components/smart-toolbar/bubble/bubble-rules";

import {
  expectNoSeriousA11yViolations,
  NO_FORCED_COLOURS,
  resolveRgb,
  setTheme,
} from "./helpers/a11y";
import { EditorPage } from "./helpers/editor-page";
import { CHUNK_MARKERS, holdChunk, interceptChunk } from "./helpers/lazy-chunk";
import { listenerCounts } from "./helpers/listener-counts";

const SCREENS = ".superpowers/screens-r2-bubble";

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
    paragraph(text("First line under the toolbar")),
    paragraph(text("Select some words in this paragraph")),
    paragraph(
      text("Visit "),
      text("the example site", [
        { type: "hyperlink", attrs: { href: "https://example.com" } },
      ]),
      text(" today"),
    ),
    {
      type: "codeBlock",
      attrs: { language: "typescript" },
      content: [text("const answer = 42;")],
    },
    { type: "horizontalRule" },
    ...Array.from({ length: 30 }, (_, i) =>
      paragraph(text(`Filler paragraph number ${i + 1} for scrolling`)),
    ),
  ],
};

const bubble = (page: Page) => page.locator("[data-smart-bubble]");
const bubbleToolbar = (page: Page) =>
  page.getByRole("toolbar", { name: "Selection formatting" });
const row = (page: Page) =>
  page.getByRole("toolbar", { name: "Formatting", exact: true });
/** Style ▾, named by its face ("Text", "H2 Heading 2"). */
const styleButton = (page: Page) =>
  bubbleToolbar(page).locator("button[data-face]");

/**
 * Loads `doc` outside the undo history, as the app seeds a document: an
 * undo in a test then reverts the test's own edit, never the fixture.
 */
async function openDoc(page: Page, doc: object = DOC): Promise<EditorPage> {
  const editorPage = new EditorPage(page);
  await editorPage.goto();
  await editorPage.waitForSync();
  await page.evaluate((content) => {
    const editor = window.__tiptap_editor;
    if (!editor) throw new Error("editor missing");
    editor.chain().setMeta("addToHistory", false).setContent(content).run();
  }, doc);
  // The settle time `EditorPage.setContent` gives: a mouse drag right after
  // the content lands opens no bubble in Chromium (not investigated here).
  await page.waitForTimeout(200);
  return editorPage;
}

/** Selects `needle` (the `nth` match) with a focused editor, like a drag. */
async function selectText(page: Page, needle: string, nth = 0) {
  await page.evaluate(
    ([target, index]) => {
      const editor = window.__tiptap_editor;
      if (!editor) throw new Error("editor missing");
      let from = -1;
      let seen = 0;
      editor.state.doc.descendants((node, pos) => {
        if (from >= 0 || !node.isText) return from < 0;
        const at = node.text?.indexOf(target as string) ?? -1;
        if (at >= 0) {
          if (seen === index) from = pos + at;
          seen += 1;
        }
        return from < 0;
      });
      if (from < 0) throw new Error(`"${target}" not found`);
      editor
        .chain()
        .focus()
        .setTextSelection({ from, to: from + (target as string).length })
        .run();
    },
    [needle, nth] as const,
  );
}

/** Drag-selects `needle` with the mouse (a real pointer selection). */
async function dragSelect(page: Page, needle: string) {
  const box = await page.evaluate((target) => {
    const editor = window.__tiptap_editor;
    if (!editor) throw new Error("editor missing");
    let from = -1;
    editor.state.doc.descendants((node, pos) => {
      if (from >= 0 || !node.isText) return from < 0;
      const at = node.text?.indexOf(target) ?? -1;
      if (at >= 0) from = pos + at;
      return from < 0;
    });
    const start = editor.view.coordsAtPos(from);
    const end = editor.view.coordsAtPos(from + target.length);
    return {
      x1: start.left + 1,
      x2: end.right - 1,
      y: (start.top + start.bottom) / 2,
    };
  }, needle);
  await page.mouse.move(box.x1, box.y);
  await page.mouse.down();
  await page.mouse.move(box.x2, box.y, { steps: 5 });
  await page.mouse.up();
}

/** Selects a filler line and scrolls it to 10px under the sticky toolbar. */
async function selectUnderToolbar(page: Page) {
  await selectText(page, "Filler paragraph number 12");
  // After `focus()` has scrolled the selection into view, never before it.
  await expectBubbleOpen(page);
  await page.evaluate(() => {
    const wrapper = document.querySelector(".document-editor-wrapper");
    const toolbar = wrapper?.querySelector('[data-slot="toolbar"]');
    const editor = window.__tiptap_editor;
    if (!wrapper || !toolbar || !editor) throw new Error("missing");
    const line = editor.view.coordsAtPos(editor.state.selection.from);
    const target = toolbar.getBoundingClientRect().bottom + 10;
    wrapper.scrollTop += line.top - target;
  });
}

/** One Esc on a bubble item returns to the editor, tooltip or not (M3). */
async function escapeToEditor(page: Page) {
  await page.keyboard.press("Escape");
  await expect(page.locator(".tiptap")).toBeFocused();
}

const selectionRange = (page: Page) =>
  page.evaluate(() => {
    const selection = window.__tiptap_editor?.state.selection;
    return { from: selection?.from, to: selection?.to };
  });

/** A Repeat bundle remembered from an earlier visit (Bold). */
const rememberBoldBundle = (page: Page) =>
  page.addInitScript(() => {
    localStorage.setItem(
      "tinydocy-choices",
      JSON.stringify({
        v: 1,
        slots: { repeatBundle: { last: { bold: true }, recent: [] } },
      }),
    );
  });

async function expectBubbleOpen(page: Page) {
  await expect(bubble(page)).toHaveAttribute("data-state", "open");
  await expect(bubbleToolbar(page)).toBeVisible();
}

/**
 * The focus outline (width + offset) fits inside every clipping ancestor, so
 * the 2px ring is never cut (PR A carry-over for the floating variant).
 */
async function expectOutlineNotClipped(item: Locator, minGrow = 2) {
  const clipped = await item.evaluate((el) => {
    const style = getComputedStyle(el);
    const grow =
      Number.parseFloat(style.outlineWidth) +
      Number.parseFloat(style.outlineOffset);
    const box = el.getBoundingClientRect();
    const ring = {
      top: box.top - grow,
      bottom: box.bottom + grow,
      left: box.left - grow,
      right: box.right + grow,
    };
    const problems: string[] = [];
    for (
      let node = el.parentElement;
      node && node !== document.body;
      node = node.parentElement
    ) {
      const { overflowX, overflowY } = getComputedStyle(node);
      if (overflowX === "visible" && overflowY === "visible") continue;
      const clip = node.getBoundingClientRect();
      if (
        ring.top < clip.top ||
        ring.bottom > clip.bottom ||
        ring.left < clip.left ||
        ring.right > clip.right
      ) {
        problems.push(`${node.tagName}.${node.className}`);
      }
    }
    return { grow, problems };
  });
  expect(clipped.grow).toBeGreaterThanOrEqual(minGrow);
  expect(clipped.problems).toEqual([]);
}

test.describe("selection bubble", () => {
  test("shows Style, B, I, U, S, code, clear, colour, link and Paint format for a mouse selection", async ({
    page,
  }) => {
    await openDoc(page);
    await dragSelect(page, "some words");
    await expectBubbleOpen(page);
    const names = await bubbleToolbar(page)
      .getByRole("button")
      .evaluateAll((buttons) =>
        buttons.map(
          (b) => b.getAttribute("aria-label") ?? b.textContent?.trim() ?? "",
        ),
      );
    // Spec §7.1: Style ▾ │ B I U S ‹› Tx │ A▁▾ 🔗 🖌 │ 💬 (unregistered).
    expect(names).toEqual([
      "Turn into Text",
      "Bold",
      "Italic",
      "Underline",
      "Strike",
      "Inline code",
      "Clear formatting",
      expect.stringMatching(/^Apply text colour: /),
      "More text colours",
      "Link",
      "Paint format",
    ]);
    const style = styleButton(page);
    await expect(style).toHaveAccessibleName("Turn into Text");
    await expect(style).toHaveAttribute("aria-haspopup", "menu");
    // The face is sized once to the longest face word, at least 64px.
    const width = await style.evaluate(
      (el) => el.getBoundingClientRect().width,
    );
    expect(width).toBeGreaterThanOrEqual(64);
    expect(width).toBeLessThanOrEqual(96);
    // One Tab stop: the plugin's root is not focusable, not even by a click.
    await expect(bubble(page)).not.toHaveAttribute("tabindex");
    const box = await bubbleToolbar(page).boundingBox();
    const sel = await page.evaluate(() => {
      const editor = window.__tiptap_editor;
      if (!editor) throw new Error("editor missing");
      return editor.view.coordsAtPos(editor.state.selection.from);
    });
    expect(box && box.y + box.height).toBeLessThanOrEqual(sel.top);
  });

  test("stays hidden for an empty selection, a rule, code, a link and read-only", async ({
    page,
  }) => {
    await openDoc(page);
    const hidden = async () => {
      await page.waitForTimeout(400);
      await expect(bubble(page)).toHaveCount(0);
    };

    await selectText(page, "some words");
    await expectBubbleOpen(page);

    await page.keyboard.press("ArrowRight");
    await hidden();

    await page.evaluate(() => {
      const editor = window.__tiptap_editor;
      if (!editor) throw new Error("editor missing");
      let rule = -1;
      editor.state.doc.forEach((node, offset) => {
        if (node.type.name === "horizontalRule") rule = offset;
      });
      editor.chain().focus().setNodeSelection(rule).run();
    });
    await hidden();

    await selectText(page, "answer");
    await hidden();

    await selectText(page, "example");
    await hidden();

    await selectText(page, "some words");
    await expectBubbleOpen(page);
    await page.evaluate(() => window.__tiptap_editor?.setEditable(false));
    await expect(bubble(page)).toHaveCount(0);
    await selectText(page, "Select");
    await hidden();
  });

  test("typing hides it; Shift+ArrowRight keeps it; Esc fades it out", async ({
    page,
  }) => {
    await openDoc(page);
    await selectText(page, "some");
    await expectBubbleOpen(page);
    await page.keyboard.press("Shift+ArrowRight");
    await page.waitForTimeout(400);
    await expectBubbleOpen(page);

    await page.keyboard.press("Escape");
    await expect(bubble(page)).toHaveAttribute("data-closing", "");
    await expect(bubble(page)).toHaveAttribute("data-state", "closed");
    await expect(bubble(page)).toHaveCount(0, { timeout: 500 });
    // Esc keeps the selection, and the bubble stays away until a new one.
    expect(await selectionRange(page)).not.toEqual({ from: 0, to: 0 });
    await page.waitForTimeout(400);
    await expect(bubble(page)).toHaveCount(0);
    await page.keyboard.press("Shift+ArrowRight");
    await expectBubbleOpen(page);

    await page.keyboard.type("x");
    await expect(bubble(page)).toHaveCount(0);
    await page.keyboard.press("Shift+ArrowLeft");
    await expectBubbleOpen(page);
    // A shortcut keeps it.
    await page.keyboard.press("ControlOrMeta+b");
    await page.waitForTimeout(400);
    await expectBubbleOpen(page);
  });

  test("Alt+F10 focuses the bubble; Esc returns to the editor with the same selection", async ({
    page,
  }) => {
    await openDoc(page);
    await selectText(page, "some words");
    await expectBubbleOpen(page);
    const before = await selectionRange(page);

    await page.keyboard.press("Alt+F10");
    // Spec §14: Alt+F10 lands on Style ▾, the first item.
    await expect(styleButton(page)).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(
      bubbleToolbar(page).getByRole("button", { name: "Bold", exact: true }),
    ).toBeFocused();
    // One Esc, even with the item's focus tooltip open, as in the row.
    await escapeToEditor(page);
    expect(await selectionRange(page)).toEqual(before);
    await expect(bubble(page)).toHaveCount(0, { timeout: 500 });

    // No bubble: Alt+F10 goes to the row (D1).
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Alt+F10");
    const focusedInRow = await row(page).evaluate((el) =>
      el.contains(document.activeElement),
    );
    expect(focusedInRow).toBe(true);
  });

  test("keyboard colour pick inside the bubble keeps it attached", async ({
    page,
  }) => {
    await openDoc(page);
    await selectText(page, "some words");
    await expectBubbleOpen(page);
    await page.keyboard.press("Alt+F10");
    const chevron = bubbleToolbar(page).getByRole("button", {
      name: "More text colours",
    });
    for (let i = 0; i < 8; i += 1) await page.keyboard.press("ArrowRight");
    await expect(chevron).toBeFocused();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Text colours" });
    await expect(dialog).toBeVisible();
    // The panel is a lazy chunk: wait until it has put focus on a swatch.
    await expect(dialog.locator("button:focus")).toHaveCount(1);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    await expect
      .poll(() =>
        page.evaluate(() => {
          const editor = window.__tiptap_editor;
          let colour: string | null = null;
          editor?.state.doc.descendants((node) => {
            const mark = node.marks.find((m) => m.type.name === "textColor");
            if (mark && node.text?.includes("some")) colour = mark.attrs.color;
          });
          return colour;
        }),
      )
      .not.toBeNull();
    // Past the plugin's 250 ms update debounce: still attached.
    await page.waitForTimeout(400);
    await expect(bubble(page)).toHaveAttribute("data-state", "open");
    if (await dialog.isVisible()) await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(chevron).toBeFocused();
    await expectBubbleOpen(page);
  });

  test("bubble-in-row matrix", async ({ page }) => {
    // No filler. Playwright scrolls its target on a click retry (the bubble
    // is still sliding in); on the long page that brought the text under
    // the sticky row, the bubble flipped below it between mousedown and
    // mouseup, and the click was lost. This page scrolls by the row's
    // height at most, which keeps the text well clear of the row.
    await openDoc(page, { ...DOC, content: DOC.content.slice(0, 6) });
    // The fixture is not an undo step (y-tiptap patch): each `undo()` below
    // reverts exactly the mark the click applied.
    await expect(
      row(page).locator('[data-action-id="history.undo"]'),
    ).toHaveAttribute("aria-disabled", "true");
    // Every bubble action is also in the row at desktop width: a button,
    // or an item of ⋯ More formatting (inline code, clear formatting).
    const overflow = row(page).getByRole("button", { name: "More formatting" });
    const inOverflow = new Set(["mark.inlineCode", "format.clear"]);
    for (const id of BUBBLE_ACTION_IDS) {
      if (inOverflow.has(id)) {
        await overflow.click();
        await expect(
          page
            .getByRole("menu", { name: "More formatting" })
            .locator(`[data-action-id="${id}"]`),
        ).toBeVisible();
        await page.keyboard.press("Escape");
        continue;
      }
      const inRow =
        id === "color.text.apply"
          ? row(page).getByRole("button", { name: /^Apply text colour: / })
          : row(page).locator(`[data-action-id="${id}"]`);
      await expect(inRow).toBeVisible();
    }

    const docAfter = async (surface: "bubble" | "row", name: RegExp) => {
      await selectText(page, "some words");
      await expectBubbleOpen(page);
      const toolbar = surface === "bubble" ? bubbleToolbar(page) : row(page);
      if (surface === "row" && name.source === "^Inline code$") {
        await overflow.click();
        await page
          .getByRole("menu", { name: "More formatting" })
          .getByRole("menuitemcheckbox", { name })
          .click();
      } else {
        await toolbar.getByRole("button", { name }).click();
      }
      const json = await page.evaluate(() =>
        JSON.stringify(window.__tiptap_editor?.getJSON().content?.[2]),
      );
      await page.evaluate(() => window.__tiptap_editor?.commands.undo());
      return json;
    };
    for (const name of [
      /^Bold$/,
      /^Italic$/,
      /^Underline$/,
      /^Strike$/,
      /^Inline code$/,
      /^Apply text colour: /,
    ]) {
      const fromBubble = await docAfter("bubble", name);
      const fromRow = await docAfter("row", name);
      expect(fromBubble).toEqual(fromRow);
      expect(fromBubble).not.toEqual(
        JSON.stringify(DOC.content[2]).replace(/"marks":undefined/, ""),
      );
    }

    // Link opens the hyperlink popover from both.
    for (const surface of ["bubble", "row"] as const) {
      await selectText(page, "some words");
      await expectBubbleOpen(page);
      const toolbar = surface === "bubble" ? bubbleToolbar(page) : row(page);
      await toolbar.getByRole("button", { name: "Link", exact: true }).click();
      await expect(page.locator(".hyperlink-create-popover")).toBeVisible();
      await page.locator(".hyperlink-create-popover input").press("Escape");
      await expect(page.locator(".hyperlink-create-popover")).toBeHidden();
    }
  });

  test("bubble buttons draw their 2px ring inside, never clipped", async ({
    page,
  }) => {
    await openDoc(page);
    await selectText(page, "some words");
    await expectBubbleOpen(page);
    await page.keyboard.press("Alt+F10");
    const items = bubbleToolbar(page).getByRole("button");
    const count = await items.count();
    for (let i = 0; i < count; i += 1) {
      const item = items.nth(i);
      await expect(item).toBeFocused();
      // Spec §7.1: `outline-offset: -2px`, so a ring never crosses the 2px
      // gap onto a neighbour.
      await expect(item).toHaveCSS("outline-width", "2px");
      await expect(item).toHaveCSS("outline-offset", "-2px");
      await expectOutlineNotClipped(item, 0);
      await page.keyboard.press("ArrowRight");
    }
  });

  test("flips below when the selection sits just under the toolbar", async ({
    page,
  }) => {
    await openDoc(page);
    await selectUnderToolbar(page);
    await expect(bubble(page)).toHaveAttribute("data-placement", "bottom");
    await expect
      .poll(async () => {
        const box = await bubbleToolbar(page).boundingBox();
        const sel = await page.evaluate(() => {
          const editor = window.__tiptap_editor;
          if (!editor) throw new Error("editor missing");
          return editor.view.coordsAtPos(editor.state.selection.to).bottom;
        });
        return (box?.y ?? 0) >= sel;
      })
      .toBe(true);
  });

  test("focus moving to another control in the page hides it", async ({
    page,
  }) => {
    await openDoc(page);
    await selectText(page, "some words");
    await expectBubbleOpen(page);
    // Inside the same scroll container as the bubble: the stock blur check
    // alone would keep it.
    await row(page)
      .getByRole("button", { name: "Toggle document filter" })
      .focus();
    await expect(bubble(page)).toHaveCount(0);
    // And to another row control after a new selection.
    await selectText(page, "some words");
    await expectBubbleOpen(page);
    await row(page).getByRole("button", { name: "Undo" }).focus();
    await expect(bubble(page)).toHaveCount(0);
  });

  test("focus leaving the bubble hides it", async ({ page }) => {
    await openDoc(page);
    await selectText(page, "some words");
    await expectBubbleOpen(page);
    await page.keyboard.press("Alt+F10");
    // Spec §14: Alt+F10 lands on Style ▾, the first item.
    await expect(styleButton(page)).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(bubble(page)).toHaveCount(0);

    // A new selection by the user (Tab out suppresses it, like Esc). Not a
    // drag from inside the current one, which would drag the text.
    await dragSelect(page, "First line");
    await expectBubbleOpen(page);
    await page.keyboard.press("Alt+F10");
    await row(page).getByRole("button", { name: "Undo" }).focus();
    await expect(bubble(page)).toHaveCount(0);
  });

  test("Tab past the last item returns to the editor with the selection", async ({
    page,
  }) => {
    await openDoc(page);
    await selectText(page, "some words");
    await expectBubbleOpen(page);
    const before = await selectionRange(page);
    await page.keyboard.press("Alt+F10");
    // Spec §14: Alt+F10 lands on Style ▾, the first item.
    await expect(styleButton(page)).toBeFocused();
    await page.keyboard.press("End");
    await page.keyboard.press("Tab");
    await expect(bubble(page)).toHaveCount(0);
    await expect(page.locator(".ProseMirror")).toBeFocused();
    expect(await selectionRange(page)).toEqual(before);
    // It stays away on that focus, as after Esc, until a new selection.
    await page.waitForTimeout(400);
    await expect(bubble(page)).toHaveCount(0);
    await page.keyboard.press("Shift+ArrowRight");
    await expectBubbleOpen(page);
  });

  test("Tab out of the colour dialog leaves the bubble too", async ({
    page,
  }) => {
    await openDoc(page);
    await selectText(page, "some words");
    await expectBubbleOpen(page);
    await page.keyboard.press("Alt+F10");
    for (let i = 0; i < 8; i += 1) await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Text colours" });
    await expect(dialog.locator("button:focus")).toHaveCount(1);
    // Past Base UI's focus guards (they hand focus on, and must not count
    // as leaving) to the next stop after the toolbar.
    await page.keyboard.press("Tab");
    await expect(dialog).toHaveCount(0);
    await expect(bubble(page)).toHaveCount(0);
  });

  test("a click between the items keeps the editor focused", async ({
    page,
  }) => {
    await openDoc(page);
    await selectText(page, "some words");
    await expectBubbleOpen(page);
    const box = await bubbleToolbar(page).boundingBox();
    if (!box) throw new Error("no bubble box");
    // The panel's 4px padding.
    await page.mouse.click(box.x + 2, box.y + 2);
    await expect(page.locator(".tiptap")).toBeFocused();
    await page.keyboard.type("Z");
    await expect(page.locator(".tiptap")).toContainText(
      "Select Z in this paragraph",
    );
  });

  test("Alt+F10 goes to the row when the selection is scrolled out", async ({
    page,
  }) => {
    await openDoc(page);
    await selectText(page, "some words");
    await expectBubbleOpen(page);
    await page.evaluate(() => {
      const wrapper = document.querySelector(".document-editor-wrapper");
      if (!wrapper) throw new Error("missing");
      wrapper.scrollTop = wrapper.scrollHeight;
    });
    await expect(bubble(page)).toHaveAttribute("data-state", "closed");
    await page.keyboard.press("Alt+F10");
    await expect
      .poll(() =>
        row(page).evaluate((el) => el.contains(document.activeElement)),
      )
      .toBe(true);
  });

  test("PageDown from a bubble item never drops focus on body", async ({
    page,
    browserName,
  }) => {
    await openDoc(page);
    await selectText(page, "some words");
    await expectBubbleOpen(page);
    await page.keyboard.press("Alt+F10");
    await page.keyboard.press("ArrowRight");
    const bold = bubbleToolbar(page).getByRole("button", {
      name: "Bold",
      exact: true,
    });
    await expect(bold).toBeFocused();
    await page.keyboard.press("PageDown");
    await page.waitForTimeout(500);
    expect(
      await page.evaluate(() => document.activeElement === document.body),
    ).toBe(false);
    await expect(page.locator(".tiptap")).toBeFocused();
    // The page scrolls, the selection leaves the view and focus goes back
    // to the text. Restoring the selection there makes WebKit scroll it
    // back into view, so in WebKit the bubble shows again.
    if (browserName === "webkit") return;
    await expect(bubble(page)).not.toHaveAttribute("data-state", "open");
  });

  test("the colour popover opens away from the selection", async ({ page }) => {
    await openDoc(page);
    const overlaps = async () => {
      const dialog = page.getByRole("dialog", { name: "Text colours" });
      await bubbleToolbar(page)
        .getByRole("button", { name: "More text colours" })
        .click();
      await expect(dialog.locator("button:focus")).toHaveCount(1);
      await page.waitForTimeout(200);
      const box = await dialog.boundingBox();
      const sel = await page.evaluate(() => {
        const editor = window.__tiptap_editor;
        if (!editor) throw new Error("editor missing");
        const { from, to } = editor.state.selection;
        const a = editor.view.coordsAtPos(from);
        const b = editor.view.coordsAtPos(to);
        return {
          top: Math.min(a.top, b.top),
          bottom: Math.max(a.bottom, b.bottom),
          left: Math.min(a.left, b.left),
          right: Math.max(a.right, b.right),
        };
      });
      await page.keyboard.press("Escape");
      if (await dialog.isVisible()) await page.keyboard.press("Escape");
      if (!box) throw new Error("no dialog box");
      return (
        box.x < sel.right &&
        box.x + box.width > sel.left &&
        box.y < sel.bottom &&
        box.y + box.height > sel.top
      );
    };

    // Above: a selection in mid-viewport.
    await selectText(page, "Filler paragraph number 14");
    await expectBubbleOpen(page);
    await page.evaluate(() => {
      const wrapper = document.querySelector(".document-editor-wrapper");
      const editor = window.__tiptap_editor;
      if (!wrapper || !editor) throw new Error("missing");
      const line = editor.view.coordsAtPos(editor.state.selection.from);
      wrapper.scrollTop += line.top - window.innerHeight / 2 - 60;
    });
    await page.waitForTimeout(300);
    await expect(bubble(page)).toHaveAttribute("data-placement", "top");
    expect(await overlaps()).toBe(false);

    // Below: the bubble flips under the selection, and so does the popover.
    await selectUnderToolbar(page);
    await expect(bubble(page)).toHaveAttribute("data-placement", "bottom");
    await expectBubbleOpen(page);
    expect(await overlaps()).toBe(false);
  });

  test("axe: the bubble and its colour dialog", async ({ page }) => {
    await openDoc(page);
    await selectText(page, "some words");
    await expectBubbleOpen(page);
    await expectNoSeriousA11yViolations(page, ["[data-smart-bubble]"]);
    await bubbleToolbar(page)
      .getByRole("button", { name: "More text colours" })
      .click();
    const dialog = page.getByRole("dialog", { name: "Text colours" });
    await expect(dialog.locator("button:focus")).toHaveCount(1);
    await expectNoSeriousA11yViolations(page, ['[role="dialog"]']);
  });

  test("forced colours keep the panel border and mark pressed Bold with Highlight", async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", NO_FORCED_COLOURS);
    await page.emulateMedia({ forcedColors: "active" });
    await openDoc(page);
    await selectText(page, "some words");
    await expectBubbleOpen(page);
    const edge = await bubbleToolbar(page).evaluate((el) => {
      const cs = getComputedStyle(el);
      return { style: cs.borderTopStyle, color: cs.borderTopColor };
    });
    expect(edge.style).not.toBe("none");
    // The edge is CanvasText (spec §7.1), never a dropped grey.
    const canvasText = await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.style.color = "CanvasText";
      document.body.appendChild(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    });
    expect(await resolveRgb(page, edge.color)).toEqual(
      await resolveRgb(page, canvasText),
    );
    await page.keyboard.press("ControlOrMeta+b");
    const bold = bubbleToolbar(page).getByRole("button", {
      name: "Bold",
      exact: true,
    });
    await expect(bold).toHaveAttribute("aria-pressed", "true");
    await page.mouse.move(0, 0);
    const pressed = await bold.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { adjust: cs.forcedColorAdjust, bg: cs.backgroundColor };
    });
    expect(pressed.adjust).toBe("none");
    const highlight = await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.style.background = "Highlight";
      document.body.appendChild(probe);
      const color = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return color;
    });
    expect(await resolveRgb(page, pressed.bg)).toEqual(
      await resolveRgb(page, highlight),
    );
  });

  test("reduced motion fades in without the rise", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openDoc(page);
    await selectText(page, "some words");
    await expectBubbleOpen(page);
    await expect(bubbleToolbar(page)).toHaveCSS(
      "animation-name",
      "st-bubble-fade-in",
    );
  });

  test("read-only while the bubble popover is open", async ({ page }) => {
    await openDoc(page);
    await selectText(page, "some words");
    await expectBubbleOpen(page);
    await bubbleToolbar(page)
      .getByRole("button", { name: "More text colours" })
      .click();
    const dialog = page.getByRole("dialog", { name: "Text colours" });
    await expect(dialog).toBeVisible();
    // The editor blurs into the popup: past the 250 ms debounce, still open.
    await page.waitForTimeout(400);
    await expect(bubble(page)).toHaveAttribute("data-state", "open");
    await page.evaluate(() => window.__tiptap_editor?.setEditable(false));
    await expect(bubble(page)).toHaveCount(0);
    await expect(dialog).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.activeElement !== null &&
            document.activeElement !== document.body,
        ),
      )
      .toBe(true);
  });

  test("shows for a selection made before its chunk arrived", async ({
    page,
  }) => {
    // Under load the bubble chunk can land after the selection. Dev
    // StrictMode then registers the plugin twice with one root, and the
    // first cleanup's deferred removal used to detach the shown bubble.
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await interceptChunk(
      page,
      CHUNK_MARKERS.bubble,
      async (route, response) => {
        await held;
        await route.fulfill({ response });
      },
    );
    await openDoc(page);
    await selectText(page, "some words");
    await expect(bubble(page)).toHaveCount(0);
    release();
    await expectBubbleOpen(page);
    // Past the deferred removal (one frame) and the 250 ms update debounce.
    await page.waitForTimeout(400);
    await expectBubbleOpen(page);
  });

  test("the bubble ends with the Paint format brush, no Repeat or Formats", async ({
    page,
  }) => {
    await rememberBoldBundle(page);
    await openDoc(page);
    await selectText(page, "some words");
    await expectBubbleOpen(page);
    const brush = bubbleToolbar(page).getByRole("button", {
      name: "Paint format",
    });
    await expect(brush).toHaveAttribute("aria-pressed", "false");
    await expect(
      bubbleToolbar(page).locator('[data-action-id="repeat.apply"]'),
    ).toHaveCount(0);
    await expect(
      bubbleToolbar(page).getByRole("button", { name: "Formats" }),
    ).toHaveCount(0);
    // The brush ends the colour, link and paint group (spec §7.1); it is
    // the last item until the comments PR registers 💬.
    expect(
      await brush.evaluate((el) => {
        const items = [
          ...(el
            .closest('[role="toolbar"]')
            ?.querySelectorAll('button, [data-slot="toolbar-separator"]') ??
            []),
        ];
        const at = items.indexOf(el);
        return [
          at === items.length - 1,
          items[at - 1]?.getAttribute("data-action-id"),
        ];
      }),
    ).toEqual([true, "mark.link"]);
    const box = await brush.boundingBox();
    expect(box?.width).toBeCloseTo(28, 1);
    expect(box?.height).toBeCloseTo(28, 1);
  });

  test("the brush is pressed at once before the engine lands, never 'loading'", async ({
    page,
  }) => {
    const engine = await holdChunk(page, CHUNK_MARKERS.engine);
    await openDoc(page);
    await selectText(page, "some words");
    await expectBubbleOpen(page);
    const brush = bubbleToolbar(page).getByRole("button", {
      name: "Paint format",
    });
    await expect(brush).not.toHaveAttribute("aria-disabled", "true");
    await brush.click();
    await expect(brush).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByText("Formatting tools are still loading."),
    ).toHaveCount(0);
    engine.release();
    // The press arms it on the same text once the engine lands.
    await expect(
      page.getByRole("status").filter({ hasText: /^Picked up / }),
    ).toBeAttached();
    await expect(brush).toHaveAttribute("aria-pressed", "true");
    await engine.restore();
  });

  test("inside inline code, marks, colour, link and paint say why; Tx and Style stay", async ({
    page,
  }) => {
    await openDoc(page);
    await selectText(page, "some words");
    await page.evaluate(() =>
      window.__tiptap_editor?.commands.setMark("inlineCode"),
    );
    await selectText(page, "some words");
    await expectBubbleOpen(page);
    const toolbar = bubbleToolbar(page);
    // Spec §7.2: `inlineCode` excludes every other mark.
    for (const name of [
      /^Bold$/,
      /^Italic$/,
      /^Underline$/,
      /^Strike$/,
      /^Apply text colour: /,
      /^More text colours$/,
      /^Link$/,
      /^Paint format$/,
    ]) {
      const item = toolbar.getByRole("button", { name });
      await expect(item, String(name)).toHaveAttribute("aria-disabled", "true");
      await expect(item, String(name)).toHaveAccessibleDescription(
        /Inline code/,
      );
    }
    for (const name of [
      /^Inline code$/,
      /^Clear formatting$/,
      /^Turn into Text$/,
    ]) {
      await expect(toolbar.getByRole("button", { name })).not.toHaveAttribute(
        "aria-disabled",
        "true",
      );
    }
  });

  for (const theme of ["light", "dark"] as const) {
    test(`screenshots: above, below and with the popover (${theme})`, async ({
      page,
    }) => {
      mkdirSync(SCREENS, { recursive: true });
      await setTheme(page, theme);
      await openDoc(page);
      await selectText(page, "some words");
      await expectBubbleOpen(page);
      await page.waitForTimeout(200);
      await page.screenshot({ path: `${SCREENS}/bubble-above-${theme}.png` });

      await bubbleToolbar(page)
        .getByRole("button", { name: "More text colours" })
        .click();
      const dialog = page.getByRole("dialog", { name: "Text colours" });
      await expect(dialog.locator("button:focus")).toHaveCount(1);
      await page.waitForTimeout(200);
      await page.screenshot({ path: `${SCREENS}/bubble-popover-${theme}.png` });
      await page.keyboard.press("Escape");

      await selectUnderToolbar(page);
      await expect(bubble(page)).toHaveAttribute("data-placement", "bottom");
      await page.waitForTimeout(200);
      await page.screenshot({ path: `${SCREENS}/bubble-below-${theme}.png` });
    });
  }
});

test("no bubble on a coarse pointer", async ({ browser }) => {
  const context = await browser.newContext({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 1024, height: 768 },
  });
  const page = await context.newPage();
  try {
    await openDoc(page);
    expect(
      await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
    ).toBe(true);
    await selectText(page, "some words");
    await page.waitForTimeout(500);
    await expect(bubble(page)).toHaveCount(0);
  } finally {
    await context.close();
  }
});

/** The non-Playground tab `openDoc` opened. */
const docTabId = async (page: Page) => {
  const id = await page
    .locator('[data-tab-id]:not([data-tab-id="playground"])')
    .first()
    .getAttribute("data-tab-id");
  if (!id) throw new Error("no document tab");
  return id;
};

/** Switches to tab `id` and waits for its new editor's server sync. */
async function openTab(page: Page, id: string) {
  await page.evaluate(() => {
    const el = document.querySelector(".ProseMirror");
    if (el) Object.assign(el, { tabProbeOld: true });
  });
  await page.locator(`[data-tab-id="${id}"] [aria-selected]`).click();
  await page.waitForFunction(() => {
    const region = document.querySelector(".document-editor-content");
    const view = region?.querySelector(".ProseMirror");
    return (
      region?.getAttribute("data-server-synced") === "true" &&
      view != null &&
      !("tabProbeOld" in view)
    );
  });
}

const TURN_DOC = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [text("Title")] },
    paragraph(text("Plain words to turn")),
    {
      type: "bulletList",
      content: [
        { type: "listItem", content: [paragraph(text("Listed words"))] },
      ],
    },
    { type: "blockquote", content: [paragraph(text("Quoted words"))] },
    { type: "heading", attrs: { level: 2 }, content: [text("Heading words")] },
    paragraph(text("Tail paragraph")),
  ],
};

/** The top-level block holding `needle`, with its first child's type. */
const blockOf = (page: Page, needle: string) =>
  page.evaluate((target) => {
    let found = "";
    window.__tiptap_editor?.state.doc.forEach((node) => {
      if (!found && node.textContent.includes(target)) {
        found = `${node.type.name}${node.attrs.level ? node.attrs.level : ""}`;
      }
    });
    return found;
  }, needle);

/** Opens Style ▾ from the bubble and picks `item` ("Text", "Heading 2"). */
async function turnInto(page: Page, needle: string, item: string) {
  await selectText(page, needle);
  await expectBubbleOpen(page);
  await styleButton(page).click();
  await page
    .getByRole("menu", { name: "Turn into" })
    .getByRole("menuitemradio", { name: item, exact: true })
    .click();
  await expect(page.getByRole("menu")).toHaveCount(0);
}

test.describe("bubble Style ▾ (spec §7.2, §7.4)", () => {
  test("the face follows the selection while the bubble is open", async ({
    page,
  }) => {
    await openDoc(page, TURN_DOC);
    await selectText(page, "Plain words");
    await expectBubbleOpen(page);
    await expect(styleButton(page)).toHaveAttribute("data-face", "Text");
    await expect(styleButton(page)).toHaveAccessibleName("Turn into Text");
    // Shift+Arrow keeps the bubble; the selection grows into the list.
    await selectText(page, "Listed words");
    await expect(styleButton(page)).toHaveAttribute("data-face", "List");
    await selectText(page, "Heading words");
    await expect(styleButton(page)).toHaveAccessibleName(
      "Turn into H2 Heading 2",
    );
  });

  for (const [needle, item, before, after] of [
    ["Listed words", "Text", "bulletList", "paragraph"],
    ["Quoted words", "Heading 2", "blockquote", "heading2"],
    ["Heading words", "Bullet list", "heading2", "bulletList"],
  ] as const) {
    test(`turn into ${item} from ${before} is one undo step`, async ({
      page,
    }) => {
      await openDoc(page, TURN_DOC);
      expect(await blockOf(page, needle)).toBe(before);
      await turnInto(page, needle, item);
      await expect.poll(() => blockOf(page, needle)).toBe(after);
      await expect(page.locator(".tiptap")).toBeFocused();
      await page.keyboard.press("ControlOrMeta+z");
      await expect.poll(() => blockOf(page, needle)).toBe(before);
    });
  }

  test("RTL: the inline-end arrow opens More headings; Esc goes back one level at a time", async ({
    page,
  }) => {
    await openDoc(page, TURN_DOC);
    await page.evaluate(() =>
      document.documentElement.setAttribute("dir", "rtl"),
    );
    await selectText(page, "Plain words");
    await expectBubbleOpen(page);
    await page.keyboard.press("Alt+F10");
    await expect(styleButton(page)).toBeFocused();
    await page.keyboard.press("Enter");
    const menu = page.getByRole("menu", { name: "Turn into" });
    await expect(menu).toBeVisible();
    const more = menu.getByRole("menuitem", { name: "More headings" });
    for (let i = 0; i < 6; i += 1) {
      if (await more.evaluate((el) => el === document.activeElement)) break;
      await page.keyboard.press("ArrowDown");
    }
    await expect(more).toBeFocused();
    // In RTL the inline end is the left.
    await page.keyboard.press("ArrowLeft");
    await expect(
      page.getByRole("menuitemradio", { name: "Heading 4" }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(more).toBeFocused();
    await expect(menu).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(styleButton(page)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.locator(".tiptap")).toBeFocused();
  });
});

test.describe("selection bubble controller (spec §12.1)", () => {
  test("mounting the bubble chunk registers no plugin", async ({ page }) => {
    const chunk = await holdChunk(page, CHUNK_MARKERS.bubble);
    await openDoc(page);
    await page.evaluate(() => {
      const editor = window.__tiptap_editor;
      if (!editor) throw new Error("editor missing");
      const views = (editor.view as unknown as { pluginViews: object[] })
        .pluginViews;
      Object.assign(window, {
        __bubbleProbe: {
          plugins: editor.state.plugins.length,
          views: new WeakSet(views),
        },
      });
    });
    chunk.release();
    await dragSelect(page, "some words");
    await expectBubbleOpen(page);
    const after = await page.evaluate(() => {
      const editor = window.__tiptap_editor;
      if (!editor) throw new Error("editor missing");
      const probe = (
        window as unknown as {
          __bubbleProbe: { plugins: number; views: WeakSet<object> };
        }
      ).__bubbleProbe;
      const views = (editor.view as unknown as { pluginViews: object[] })
        .pluginViews;
      return {
        plugins: editor.state.plugins.length,
        before: probe.plugins,
        rebuilt: views.filter((view) => !probe.views.has(view)).length,
      };
    });
    expect(after.plugins).toBe(after.before);
    expect(after.rebuilt).toBe(0);
    await chunk.restore();
  });

  test("Esc on a bubble item plays the exit fade before the root leaves", async ({
    page,
  }) => {
    await openDoc(page);
    await selectText(page, "some words");
    await expectBubbleOpen(page);
    await page.keyboard.press("Alt+F10");
    // Spec §14: Alt+F10 lands on Style ▾, the first item.
    await expect(styleButton(page)).toBeFocused();
    // Times, in the page, of `data-closing` appearing and the root leaving.
    await page.evaluate(() => {
      const root = document.querySelector("[data-smart-bubble]");
      const wrapper = root?.parentElement;
      if (!root || !wrapper) throw new Error("no bubble");
      const times: { closing?: number; removed?: number } = {};
      Object.assign(window, { __fadeTimes: times });
      new MutationObserver(() => {
        if (times.closing === undefined && root.hasAttribute("data-closing")) {
          times.closing = performance.now();
        }
      }).observe(root, { attributeFilter: ["data-closing"] });
      new MutationObserver(() => {
        if (times.removed === undefined && !root.isConnected) {
          times.removed = performance.now();
        }
      }).observe(wrapper, { childList: true });
    });
    await page.keyboard.press("Escape");
    await expect(page.locator(".tiptap")).toBeFocused();
    await expect(bubble(page)).toHaveCount(0);
    const times = await page.evaluate(
      () =>
        (window as unknown as { __fadeTimes: Record<string, number> })
          .__fadeTimes,
    );
    expect(times.closing).toBeDefined();
    // The 90 ms exit fade, not a hide on the returning focus.
    expect(times.removed - times.closing).toBeGreaterThanOrEqual(60);
  });

  test("a selection that wraps from the second line anchors to that line", async ({
    page,
  }) => {
    const long = Array.from(
      { length: 6 },
      (_, i) =>
        `Sentence ${i + 1} of a long paragraph that wraps across several visual lines.`,
    ).join(" ");
    await openDoc(page, {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [text("Title")] },
        paragraph(text(long)),
      ],
    });
    // 12 characters from 6 before the end of the paragraph's second visual
    // line, so the selection wraps onto the third. The anchor is the part
    // on the second line: the rects on the top-most line only (the box
    // between the two carets, the old anchor, centres mid-column).
    const target = await page.evaluate(() => {
      const editor = window.__tiptap_editor;
      if (!editor) throw new Error("editor missing");
      const view = editor.view;
      const lineStart = (after: number) => {
        const top = view.coordsAtPos(after, 1).top;
        let pos = after;
        while (view.coordsAtPos(pos, 1).top === top) pos += 1;
        return pos;
      };
      const start = (editor.state.doc.firstChild?.nodeSize ?? 0) + 1;
      const second = lineStart(start);
      const third = lineStart(second);
      const from = third - 6;
      const to = from + 12;
      editor.chain().focus().setTextSelection({ from, to }).run();
      const a = view.domAtPos(from);
      const b = view.domAtPos(to);
      const range = document.createRange();
      range.setStart(a.node, a.offset);
      range.setEnd(b.node, b.offset);
      const rects = [...range.getClientRects()].filter((r) => r.width > 0);
      const lineTop = Math.min(...rects.map((r) => r.top));
      const line = rects.filter((r) => Math.abs(r.top - lineTop) <= 2);
      const left = Math.min(...line.map((r) => r.left));
      const right = Math.max(...line.map((r) => r.right));
      return {
        secondTop: view.coordsAtPos(second, 1).top,
        lineTop,
        lines: new Set(rects.map((r) => Math.round(r.top))).size,
        centre: (left + right) / 2,
      };
    });
    expect(target.lines).toBe(2);
    expect(Math.abs(target.lineTop - target.secondTop)).toBeLessThanOrEqual(2);
    await expectBubbleOpen(page);
    await expect(bubble(page)).toHaveAttribute("data-placement", "top");
    await expect
      .poll(async () => {
        const box = await bubble(page).boundingBox();
        if (!box) return "no box";
        const centred = Math.abs(box.x + box.width / 2 - target.centre) <= 2;
        const bottom = box.y + box.height;
        const above =
          bottom <= target.lineTop &&
          bottom >= target.lineTop - 8 - box.height - 1;
        return centred && above ? "anchored" : JSON.stringify({ box, target });
      })
      .toBe("anchored");
  });

  test("a selection that starts at a paragraph's end anchors to the next line's text", async ({
    page,
  }) => {
    await openDoc(page, {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [text("Title")] },
        paragraph(text("A paragraph the selection starts after")),
        paragraph(text("Short")),
        paragraph(text("The paragraph where the selection ends")),
      ],
    });
    // From the end of the first paragraph (nothing of it is selected on
    // screen) into the third: the second is wholly inside the range, and
    // a range over it returns its full-width border box too.
    const target = await page.evaluate(() => {
      const editor = window.__tiptap_editor;
      if (!editor) throw new Error("editor missing");
      const { doc } = editor.state;
      const starts: number[] = [];
      doc.forEach((_node, offset) => {
        starts.push(offset);
      });
      const from = starts[2] - 1;
      const to = starts[3] + 5;
      editor.chain().focus().setTextSelection({ from, to }).run();
      const a = editor.view.domAtPos(starts[2] + 1);
      const range = document.createRange();
      range.selectNodeContents(a.node);
      const box = range.getBoundingClientRect();
      return { top: box.top, centre: (box.left + box.right) / 2 };
    });
    await expectBubbleOpen(page);
    await expect(bubble(page)).toHaveAttribute("data-placement", "top");
    await expect
      .poll(async () => {
        const box = await bubble(page).boundingBox();
        if (!box) return "no box";
        const centred = Math.abs(box.x + box.width / 2 - target.centre) <= 2;
        const above = box.y + box.height <= target.top;
        return centred && above ? "anchored" : JSON.stringify({ box, target });
      })
      .toBe("anchored");
  });

  /**
   * A long document scrolled to its middle, then ⌘A: the bubble is in the
   * view, just under the sticky row (under the first line that shows).
   * `edge` puts the band's top edge in the gap between two paragraphs or
   * inside one. Without `warm`, off-screen blocks keep their estimated
   * heights (`content-visibility`), and ⌘A, which renders every selected
   * block, shifts the page under the view.
   */
  async function expectSelectAllUnderRow(
    page: Page,
    blocks: unknown[],
    { edge, warm = true }: { edge?: "gap" | "inside"; warm?: boolean } = {},
  ) {
    await openDoc(page, {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [text("Title")] },
        ...blocks,
      ],
    });
    const ends = await page.evaluate(
      async ([edgeAt, warmUp]) => {
        const editor = window.__tiptap_editor;
        const wrapper = document.querySelector(".document-editor-wrapper");
        const toolbar = wrapper?.querySelector('[data-slot="toolbar"]');
        const children = editor?.view.dom.children;
        const count = children?.length ?? 0;
        const middle = children?.[Math.floor(count / 2)];
        if (!editor || !wrapper || !toolbar || !children || !middle) {
          throw new Error("missing");
        }
        const frames = () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          );
        if (warmUp) {
          editor.commands.selectAll();
          await frames();
          editor.commands.setTextSelection(1);
          await frames();
        }
        for (let i = 0; i < 5; i += 1) {
          middle.scrollIntoView({ block: "center" });
          await frames();
        }
        if (edgeAt) {
          const bandTop = toolbar.getBoundingClientRect().bottom + 1;
          const blocks = [...children].map((el) => el.getBoundingClientRect());
          const k = blocks.findIndex((box) => box.bottom > bandTop);
          const y =
            edgeAt === "gap"
              ? (blocks[k].bottom + blocks[k + 1].top) / 2
              : (blocks[k].top + blocks[k].bottom) / 2;
          wrapper.scrollTop += y - bandTop;
          await frames();
        }
        editor.view.dom.focus({ preventScroll: true });
        const size = editor.state.doc.content.size;
        return {
          first: editor.view.coordsAtPos(1).top,
          last: editor.view.coordsAtPos(size - 1).top,
        };
      },
      [edge, warm] as const,
    );
    const viewport = page.viewportSize();
    // The selection runs past both edges of the view.
    expect(ends.first).toBeLessThan(0);
    expect(ends.last).toBeGreaterThan(viewport?.height ?? 0);
    await page.keyboard.press("ControlOrMeta+a");
    await expectBubbleOpen(page);
    await expect
      .poll(async () => {
        const box = await bubble(page).boundingBox();
        const toolbarBottom = await page.evaluate(
          () =>
            document
              .querySelector('.document-editor-wrapper > [data-slot="toolbar"]')
              ?.getBoundingClientRect().bottom ?? 0,
        );
        if (!box || !viewport) return "no box";
        const inside = box.y >= 0 && box.y + box.height <= viewport.height;
        const under = box.y >= toolbarBottom && box.y <= toolbarBottom + 60;
        return inside && under
          ? "under the row"
          : JSON.stringify({ box, toolbarBottom });
      })
      .toBe("under the row");
  }

  const wrappingParagraph = (i: number) =>
    paragraph(
      text(
        `Paragraph ${i + 1} is long enough to wrap onto three visual lines in the page column, so the top edge of the view can fall inside it or in the gap after it, and the anchor must still pick the first line that shows.`,
      ),
    );

  test("select all anchors to the first visible line", async ({ page }) => {
    await expectSelectAllUnderRow(
      page,
      Array.from({ length: 300 }, (_, i) =>
        paragraph(text(`Paragraph ${i + 1} of a long document`)),
      ),
    );
  });

  for (const edge of ["gap", "inside"] as const) {
    test(`select all with multi-line paragraphs, the band edge ${edge === "gap" ? "between two" : "inside one"}`, async ({
      page,
    }) => {
      await expectSelectAllUnderRow(
        page,
        Array.from({ length: 120 }, (_, i) => wrappingParagraph(i)),
        { edge },
      );
    });
  }

  test("a whitespace-only selection shows no bubble", async ({ page }) => {
    await openDoc(page, {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [text("Title")] },
        paragraph(text("Gap     between words")),
      ],
    });
    await selectText(page, "     ");
    expect(await selectionRange(page)).not.toEqual({ from: 0, to: 0 });
    await page.waitForTimeout(400);
    await expect(bubble(page)).toHaveCount(0);
  });

  test("dragstart hides it", async ({ page }) => {
    await openDoc(page);
    await selectText(page, "some words");
    await expectBubbleOpen(page);
    await page.locator(".tiptap").dispatchEvent("dragstart");
    await expect(bubble(page)).toHaveCount(0);
  });

  test("tab switch with the bubble open leaves no root and no listeners", async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "CDP only");
    test.setTimeout(120_000);
    await openDoc(page);
    const id = await docTabId(page);
    // Warm up: both editors, their chunks and the bubble chunk exist.
    await openTab(page, "playground");
    await openTab(page, id);
    await selectText(page, "some words");
    await expectBubbleOpen(page);
    await page.evaluate(() => {
      const editor = window.__tiptap_editor;
      editor?.commands.setTextSelection(editor.state.selection.from);
    });
    await expect(bubble(page)).toHaveCount(0);
    const cdp = await page.context().newCDPSession(page);
    // Past collab-session's deferred release (1 s).
    await page.waitForTimeout(1_100);
    const before = await listenerCounts(cdp);

    for (let i = 0; i < 5; i += 1) {
      await selectText(page, "some words");
      await expectBubbleOpen(page);
      await openTab(page, "playground");
      await expect(bubble(page)).toHaveCount(0);
      await openTab(page, id);
    }
    await expect(
      page.locator(".document-editor-wrapper > [data-smart-bubble]"),
    ).toHaveCount(0);
    expect(
      await page.evaluate(() => window.__tiptap_editor?.state.selection.empty),
    ).toBe(true);
    await page.waitForTimeout(1_100);
    const after = await listenerCounts(cdp);
    test.info().annotations.push({
      type: "document + window listeners",
      description: `${JSON.stringify(before)} → ${JSON.stringify(after)}`,
    });
    expect(after).toEqual(before);
  });

  test("a collaborator deleting the selection hides the bubble", async ({
    browser,
  }) => {
    test.setTimeout(60_000);
    const docId = `bubble-collab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    try {
      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();
      await pageA.addInitScript(
        `window.__HOCUS_TOKEN = ${JSON.stringify(`user-a-${docId}`)}`,
      );
      await pageB.addInitScript(
        `window.__HOCUS_TOKEN = ${JSON.stringify(`user-b-${docId}`)}`,
      );
      const editorA = new EditorPage(pageA);
      await editorA.goto(docId);
      await editorA.waitForSync();
      await pageA.evaluate((content) => {
        window.__tiptap_editor
          ?.chain()
          .setMeta("addToHistory", false)
          .setContent(content)
          .run();
      }, DOC as object);
      const editorB = new EditorPage(pageB);
      await editorB.goto(docId);
      await editorB.waitForSync();
      await expect(pageB.locator(".tiptap")).toContainText("some words", {
        timeout: 15_000,
      });

      await selectText(pageA, "some words");
      await expectBubbleOpen(pageA);
      // Focus inside the bubble: its removal must hand focus back.
      await pageA.keyboard.press("Alt+F10");
      // Spec §14: Alt+F10 lands on Style ▾, the first item.
      await expect(styleButton(pageA)).toBeFocused();
      await pageB.evaluate(() => {
        const editor = window.__tiptap_editor;
        if (!editor) throw new Error("editor missing");
        let range: { from: number; to: number } | null = null;
        editor.state.doc.forEach((node, offset) => {
          if (!range && node.textContent.includes("some words")) {
            range = { from: offset, to: offset + node.nodeSize };
          }
        });
        if (!range) throw new Error("paragraph missing");
        editor.chain().deleteRange(range).run();
      });
      await expect(pageA.locator(".tiptap")).not.toContainText("some words", {
        timeout: 15_000,
      });
      await expect(bubble(pageA)).toHaveCount(0);
      await expect(pageA.locator(".tiptap")).toBeFocused();
      // Not suppressed: a new selection (one that clears nothing) shows it.
      await selectText(pageA, "First line");
      await expectBubbleOpen(pageA);
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});
