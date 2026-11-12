import { expect, type Page, test } from "@playwright/test";

import {
  contrastRatio,
  openToolbarTestDoc,
  resolveRgb,
  setTheme,
} from "./helpers/a11y";
import { getPlaywrightModifierKey } from "./helpers/playwright-modifier-key";

const toolbarButton = (page: Page, name: string) =>
  page.getByRole("toolbar").getByRole("button", { name, exact: true });

/** Keyboard modality first, then focus the button directly. The toolbar's own
 * arrow index is not synced to focus, so arrowing from a neighbour lands elsewhere. */
async function focusByKeyboard(page: Page, name: string) {
  const button = toolbarButton(page, name);
  await page.keyboard.press("Shift");
  await button.focus();
  expect(await button.evaluate((el) => el.matches(":focus-visible"))).toBe(
    true,
  );
  return button;
}

/** Inserts a paragraph, selects its text and presses Mod+B, so Bold is pressed. */
async function makeBoldPressed(page: Page) {
  await page.evaluate(() => {
    const editor = window.__tiptap_editor;
    if (!editor) throw new Error("editor missing");
    const end = editor.state.doc.content.size;
    editor
      .chain()
      .focus()
      .insertContentAt(end, {
        type: "paragraph",
        content: [{ type: "text", text: "pressed state" }],
      })
      .run();
    const { doc } = editor.state;
    const paragraph = doc.lastChild;
    if (!paragraph) throw new Error("paragraph missing");
    const to = doc.content.size - 1;
    editor
      .chain()
      .focus()
      .setTextSelection({ from: to - paragraph.content.size, to })
      .run();
  });
  await page.keyboard.press(`${getPlaywrightModifierKey()}+b`);
  const bold = toolbarButton(page, "Bold");
  await expect(bold).toHaveAttribute("aria-pressed", "true");
  // The button uses `transition-all`: read colours only once it has settled.
  await bold.evaluate((el) =>
    Promise.all(el.getAnimations().map((animation) => animation.finished)),
  );
  return bold;
}

for (const theme of ["light", "dark"] as const) {
  test(`focus ring is a solid 2px outline at >=3:1 (${theme})`, async ({
    page,
  }) => {
    await setTheme(page, theme);
    await openToolbarTestDoc(page);
    const bold = await focusByKeyboard(page, "Bold");
    const style = await bold.evaluate((el) => {
      const cs = getComputedStyle(el);
      const bar = getComputedStyle(el.closest("[role=toolbar]") as Element);
      return {
        outlineStyle: cs.outlineStyle,
        outlineWidth: cs.outlineWidth,
        outlineColor: cs.outlineColor,
        bg: bar.backgroundColor,
      };
    });
    expect(style.outlineStyle).toBe("solid");
    expect(Number.parseFloat(style.outlineWidth)).toBeGreaterThanOrEqual(2);
    expect(
      contrastRatio(
        await resolveRgb(page, style.outlineColor),
        await resolveRgb(page, style.bg),
      ),
    ).toBeGreaterThanOrEqual(3);
  });

  test(`pressed state has a 2px bar at >=3:1 (${theme})`, async ({ page }) => {
    await setTheme(page, theme);
    await openToolbarTestDoc(page);
    const bold = await makeBoldPressed(page);
    const style = await bold.evaluate((el) => {
      const bar = getComputedStyle(el.closest("[role=toolbar]") as Element);
      return {
        boxShadow: getComputedStyle(el).boxShadow,
        bg: bar.backgroundColor,
      };
    });
    // The computed list ends with "<colour> 0px -2px 0px 0px inset".
    const match = style.boxShadow.match(
      /([a-z]+\([^)]*\))\s+0px\s+-2px\s+0px\s+0px\s+inset$/,
    );
    expect(match, style.boxShadow).not.toBeNull();
    expect(
      contrastRatio(
        await resolveRgb(page, match?.[1] ?? ""),
        await resolveRgb(page, style.bg),
      ),
    ).toBeGreaterThanOrEqual(3);
  });
}

test("forced colours keep the focus outline and mark pressed with Highlight", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ forcedColors: "active" });
  await openToolbarTestDoc(page);

  const bold = await focusByKeyboard(page, "Bold");
  const outline = await bold.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { style: cs.outlineStyle, width: cs.outlineWidth };
  });
  expect(outline.style).toBe("solid");
  expect(Number.parseFloat(outline.width)).toBeGreaterThanOrEqual(2);

  // No outline painted on every button: an unfocused one has none.
  const italicOutline = await toolbarButton(page, "Italic").evaluate(
    (el) => getComputedStyle(el).outlineStyle,
  );
  expect(italicOutline).toBe("none");

  await makeBoldPressed(page);
  // Move focus away so the pressed background is not masked by hover/focus.
  await page.mouse.move(0, 0);
  const pressedBg = await toolbarButton(page, "Bold").evaluate(
    (el) => getComputedStyle(el).backgroundColor,
  );
  const highlight = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.background = "Highlight";
    document.body.appendChild(probe);
    const color = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return color;
  });
  expect(await resolveRgb(page, pressedBg)).toEqual(
    await resolveRgb(page, highlight),
  );

  await testInfo.attach("toolbar-forced-colors", {
    body: await page.getByRole("toolbar").screenshot(),
    contentType: "image/png",
  });
});
