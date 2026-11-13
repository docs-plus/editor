import { expect, type Locator, type Page, test } from "@playwright/test";

import {
  contrastRatio,
  expectNoSeriousA11yViolations,
  openToolbarTestDoc,
  resolveRgb,
  setTheme,
} from "./helpers/a11y";
import { getPlaywrightModifierKey } from "./helpers/playwright-modifier-key";

const toolbarButton = (page: Page, name: string) =>
  page.getByRole("toolbar").getByRole("button", { name, exact: true });

/** Keyboard modality first (so `:focus-visible` matches), then focus the
 * button directly. Arrowing from a neighbour would work too: the toolbar
 * syncs its arrow index to the focused item. */
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
  // Tiptap's focus() waits a frame; until then a toolbar button may still
  // hold focus and would swallow the shortcut.
  await expect(page.locator(".tiptap")).toBeFocused();
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

/** Types a word into a fresh paragraph and selects it. */
async function selectWord(page: Page) {
  await page.evaluate(() => {
    const editor = window.__tiptap_editor;
    if (!editor) throw new Error("editor missing");
    const end = editor.state.doc.content.size;
    editor
      .chain()
      .focus()
      .insertContentAt(end, {
        type: "paragraph",
        content: [{ type: "text", text: "highlight me" }],
      })
      .run();
    const { doc } = editor.state;
    const to = doc.content.size - 1;
    editor
      .chain()
      .focus()
      .setTextSelection({ from: to - "highlight me".length, to })
      .run();
  });
}

/** A focused swatch can show its tooltip, and Esc dismisses that first
 * (WCAG 1.4.13); the next Esc closes the dialog. Never more than two. */
async function closeWithEscape(page: Page, dialog: Locator) {
  for (let press = 0; press < 2; press += 1) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
    if (!(await dialog.isVisible())) return;
  }
  await expect(dialog).toBeHidden();
}

test("highlight dialog: named swatches, focus on open, arrows move focus only", async ({
  page,
}) => {
  await openToolbarTestDoc(page);
  await selectWord(page);
  const trigger = page
    .getByRole("toolbar")
    .getByRole("button", { name: /highlight/i })
    .first();
  await expect(trigger).not.toHaveAttribute("aria-pressed", /.*/);
  await expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
  await trigger.click();

  const dialog = page.getByRole("dialog", { name: "Highlight colours" });
  await expect(
    dialog.getByRole("group", { name: "Highlight colours" }),
  ).toBeVisible();
  await expect(
    dialog.locator('[role="menuitem"], [tabindex="0"]:not(button)'),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Green highlight" }),
  ).toBeFocused();

  const before = await page.evaluate(() => window.__tiptap_editor?.getJSON());
  await page.keyboard.press("ArrowRight");
  await expect(
    dialog.getByRole("button", { name: "Blue highlight" }),
  ).toBeFocused();
  expect(await page.evaluate(() => window.__tiptap_editor?.getJSON())).toEqual(
    before,
  );

  await page.keyboard.press("Enter");
  await expect(
    dialog.getByRole("button", { name: "Blue highlight" }),
  ).toHaveAttribute("aria-pressed", "true");
  await closeWithEscape(page, dialog);
  await expect(trigger).toBeFocused();

  // Reopen: Blue is pressed, focused and carries a check glyph.
  await page.keyboard.press("Enter");
  const blue = dialog.getByRole("button", { name: "Blue highlight" });
  await expect(blue).toBeFocused();
  await expect(blue).toHaveAttribute("aria-pressed", "true");
  await expect(blue.locator("svg")).toHaveCount(1);
  await closeWithEscape(page, dialog);
  await expect(trigger).toBeFocused();
});

test("highlight dialog: No highlight keeps focus, Esc returns it to the trigger", async ({
  page,
}) => {
  await openToolbarTestDoc(page);
  await selectWord(page);
  const trigger = page
    .getByRole("toolbar")
    .getByRole("button", { name: /highlight/i })
    .first();
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Highlight colours" });
  const green = dialog.getByRole("button", { name: "Green highlight" });
  await expect(green).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(green).toHaveAttribute("aria-pressed", "true");

  const none = dialog.getByRole("button", { name: "No highlight" });
  await none.focus();
  await page.keyboard.press("Enter");
  await expect(green).toHaveAttribute("aria-pressed", "false");
  expect(
    await page.evaluate(() => window.__tiptap_editor?.isActive("highlight")),
  ).toBe(false);
  await expect(none).toBeFocused();
  await closeWithEscape(page, dialog);
  await expect(trigger).toBeFocused();
});

const SWATCHES = ["Green", "Blue", "Red", "Purple", "Yellow"] as const;

for (const mode of ["light", "dark", "forced colours"] as const) {
  test(`highlight check glyph is visible on every swatch (${mode})`, async ({
    page,
  }, testInfo) => {
    const forced = mode === "forced colours";
    if (forced) await page.emulateMedia({ forcedColors: "active" });
    else await setTheme(page, mode);
    await openToolbarTestDoc(page);
    await selectWord(page);
    await page
      .getByRole("toolbar")
      .getByRole("button", { name: /highlight/i })
      .first()
      .click();
    const dialog = page.getByRole("dialog", { name: "Highlight colours" });

    for (const name of SWATCHES) {
      const swatch = dialog.getByRole("button", { name: `${name} highlight` });
      await swatch.click();
      await expect(swatch).toHaveAttribute("aria-pressed", "true");
      const dot = await swatch
        .locator(".tiptap-button-highlight")
        .evaluate((el) => {
          const cs = getComputedStyle(el);
          const check = el.querySelector("svg");
          return {
            adjust: cs.forcedColorAdjust,
            border: cs.borderTopWidth,
            bg: cs.backgroundColor,
            check: check ? getComputedStyle(check).color : "",
          };
        });
      // Forced colours keep the dot's colour and outline it in CanvasText;
      // elsewhere the theme decides.
      expect(dot.adjust).toBe(forced ? "none" : "auto");
      expect(dot.border).toBe(forced ? "1px" : "0px");
      expect(
        contrastRatio(
          await resolveRgb(page, dot.check),
          await resolveRgb(page, dot.bg),
        ),
        `${name} check on its swatch`,
      ).toBeGreaterThanOrEqual(3);
    }

    await dialog.screenshot({
      path: testInfo.outputPath(`highlight-dialog-${mode.split(" ")[0]}.png`),
    });
  });
}

test("mobile highlight panel: one arrow press moves one swatch", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openToolbarTestDoc(page);
  await selectWord(page);
  await page
    .getByRole("toolbar")
    .getByRole("button", { name: "Highlight text" })
    .click();

  const group = page.getByRole("group", { name: "Highlight colours" });
  await expect(group).toBeVisible();
  const green = group.getByRole("button", { name: "Green highlight" });
  await green.focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    group.getByRole("button", { name: "Blue highlight" }),
  ).toBeFocused();
});

const CONTEXTS = [
  "paragraph",
  "title",
  "heading",
  "bullet list",
  "code block",
  "table",
  "read-only",
] as const;
type Context = (typeof CONTEXTS)[number];

const CONTEXT_CONTENT: Record<
  Exclude<Context, "title" | "read-only">,
  object
> = {
  paragraph: {
    type: "paragraph",
    content: [{ type: "text", text: "plain text" }],
  },
  heading: {
    type: "heading",
    attrs: { level: 2 },
    content: [{ type: "text", text: "A section" }],
  },
  "bullet list": {
    type: "bulletList",
    content: [
      {
        type: "listItem",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "item" }] },
        ],
      },
    ],
  },
  "code block": {
    type: "codeBlock",
    attrs: { language: "javascript" },
    content: [{ type: "text", text: "const a = 1;" }],
  },
  table: {
    type: "table",
    content: [
      {
        type: "tableRow",
        content: [
          {
            type: "tableCell",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "cell" }] },
            ],
          },
        ],
      },
    ],
  },
};

/** Appends a block of the given kind and puts the caret inside it. */
async function placeCaretIn(page: Page, context: Context) {
  await page.evaluate(
    ({ context, node }) => {
      const editor = window.__tiptap_editor;
      if (!editor) throw new Error("editor missing");
      if (context === "title") {
        editor.chain().focus().setTextSelection(1).run();
        return;
      }
      if (context === "read-only") {
        editor.setEditable(false);
        return;
      }
      const end = editor.state.doc.content.size;
      editor.chain().focus().insertContentAt(end, node).run();
      editor.commands.setTextSelection(editor.state.doc.content.size - 3);
    },
    {
      context,
      node:
        context === "title" || context === "read-only"
          ? null
          : CONTEXT_CONTENT[context],
    },
  );
}

type Popup = "text style menu" | "list menu" | "highlight dialog";

async function openPopup(page: Page, popup: Popup) {
  const toolbar = page.getByRole("toolbar");
  if (popup === "highlight dialog") {
    await selectWord(page);
    await toolbar
      .getByRole("button", { name: /highlight/i })
      .first()
      .click();
    await expect(
      page.getByRole("dialog", { name: "Highlight colours" }),
    ).toBeVisible();
    return;
  }
  const menus = toolbar.locator('button[aria-haspopup="menu"]');
  await menus.nth(popup === "text style menu" ? 0 : 1).click();
  await expect(page.getByRole("menu")).toBeVisible();
}

for (const theme of ["light", "dark"] as const) {
  for (const context of CONTEXTS) {
    test(`toolbar has no serious axe violations: ${context}, ${theme}`, async ({
      page,
    }) => {
      await setTheme(page, theme);
      await openToolbarTestDoc(page);
      await placeCaretIn(page, context);
      await expectNoSeriousA11yViolations(page, ['[role="toolbar"]']);
    });
  }
  for (const popup of [
    "text style menu",
    "list menu",
    "highlight dialog",
  ] as const) {
    test(`open ${popup} has no serious axe violations (${theme})`, async ({
      page,
    }) => {
      await setTheme(page, theme);
      await openToolbarTestDoc(page);
      await openPopup(page, popup);
      await expectNoSeriousA11yViolations(page, [
        '[role="toolbar"]',
        '[role="menu"], [role="dialog"]',
      ]);
    });
  }
}
