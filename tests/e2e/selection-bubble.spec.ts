/**
 * Selection bubble (spec §4.3, D2 plan task 5): desktop only. B · I · U │
 * text colour split │ link; every action is also in the row.
 */
import { mkdirSync } from "node:fs";

import { expect, type Locator, type Page, test } from "@playwright/test";

import { BUBBLE_ACTION_IDS } from "@/components/smart-toolbar/bubble/bubble-rules";

import {
  expectNoSeriousA11yViolations,
  resolveRgb,
  setTheme,
} from "./helpers/a11y";
import { EditorPage } from "./helpers/editor-page";
import { CHUNK_MARKERS, interceptChunk } from "./helpers/lazy-chunk";

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

async function openDoc(page: Page): Promise<EditorPage> {
  const editorPage = new EditorPage(page);
  await editorPage.goto();
  await editorPage.waitForSync();
  await editorPage.setContent(DOC);
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
async function expectOutlineNotClipped(item: Locator) {
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
  expect(clipped.grow).toBeGreaterThanOrEqual(2);
  expect(clipped.problems).toEqual([]);
}

test.describe("selection bubble", () => {
  test("shows B, I, U, text colour, link and Paint format for a mouse selection", async ({
    page,
  }) => {
    await openDoc(page);
    await dragSelect(page, "some words");
    await expectBubbleOpen(page);
    const names = await bubbleToolbar(page)
      .getByRole("button")
      .evaluateAll((buttons) =>
        buttons.map((b) => b.getAttribute("aria-label") ?? ""),
      );
    expect(names).toEqual([
      "Bold",
      "Italic",
      "Underline",
      expect.stringMatching(/^Apply text colour: /),
      "More text colours",
      "Link",
      "Paint format",
    ]);
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
    await expect(
      bubbleToolbar(page).getByRole("button", { name: "Bold", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(
      bubbleToolbar(page).getByRole("button", { name: "Italic", exact: true }),
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
    for (let i = 0; i < 4; i += 1) await page.keyboard.press("ArrowRight");
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
    await openDoc(page);
    // Every bubble action is also in the row at desktop width.
    for (const id of BUBBLE_ACTION_IDS) {
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
      await toolbar.getByRole("button", { name }).click();
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

  test("bubble buttons keep their 2px outline", async ({ page }) => {
    await openDoc(page);
    await selectText(page, "some words");
    await expectBubbleOpen(page);
    await page.keyboard.press("Alt+F10");
    const items = bubbleToolbar(page).getByRole("button");
    const count = await items.count();
    for (let i = 0; i < count; i += 1) {
      const item = items.nth(i);
      await expect(item).toBeFocused();
      await expectOutlineNotClipped(item);
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
    await expect(
      bubbleToolbar(page).getByRole("button", { name: "Bold", exact: true }),
    ).toBeFocused();
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
    await expect(
      bubbleToolbar(page).getByRole("button", { name: "Bold", exact: true }),
    ).toBeFocused();
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
    for (let i = 0; i < 4; i += 1) await page.keyboard.press("ArrowRight");
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
  }) => {
    await openDoc(page);
    await selectText(page, "some words");
    await expectBubbleOpen(page);
    await page.keyboard.press("Alt+F10");
    await expect(
      bubbleToolbar(page).getByRole("button", { name: "Bold", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("PageDown");
    await page.waitForTimeout(500);
    expect(
      await page.evaluate(() => document.activeElement === document.body),
    ).toBe(false);
    await expect(bubble(page)).not.toHaveAttribute("data-state", "open");
    await expect(page.locator(".tiptap")).toBeFocused();
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
  }) => {
    await page.emulateMedia({ forcedColors: "active" });
    await openDoc(page);
    await selectText(page, "some words");
    await expectBubbleOpen(page);
    const border = await bubbleToolbar(page).evaluate(
      (el) => getComputedStyle(el).borderTopStyle,
    );
    expect(border).not.toBe("none");
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
    // A separator before the brush, which is the last item.
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
          items[at - 1]?.getAttribute("data-slot"),
        ];
      }),
    ).toEqual([true, "toolbar-separator"]);
    const box = await brush.boundingBox();
    expect(box?.width).toBeCloseTo(28, 1);
    expect(box?.height).toBeCloseTo(28, 1);
  });

  test("the brush queues a click until the engine lands, never 'loading'", async ({
    page,
  }) => {
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const unroute = await interceptChunk(
      page,
      CHUNK_MARKERS.engine,
      async (route, response) => {
        await held;
        await route.fulfill({ response });
      },
    );
    await openDoc(page);
    await selectText(page, "some words");
    await expectBubbleOpen(page);
    const brush = bubbleToolbar(page).getByRole("button", {
      name: "Paint format",
    });
    await expect(brush).not.toHaveAttribute("aria-disabled", "true");
    await brush.click();
    await expect(
      page.getByText("Formatting tools are still loading."),
    ).toHaveCount(0);
    release();
    // The queued click arms it once the engine lands.
    await expect(brush).toHaveAttribute("aria-pressed", "true");
    await unroute();
  });

  test("the brush is disabled with the reason on inline code", async ({
    page,
  }) => {
    await openDoc(page);
    await selectText(page, "some words");
    await page.evaluate(() =>
      window.__tiptap_editor?.commands.setMark("inlineCode"),
    );
    await selectText(page, "some words");
    await expectBubbleOpen(page);
    const brush = bubbleToolbar(page).getByRole("button", {
      name: "Paint format",
    });
    await expect(brush).toHaveAttribute("aria-disabled", "true");
    await expect(brush).toHaveAccessibleDescription("Code has no formatting.");
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
