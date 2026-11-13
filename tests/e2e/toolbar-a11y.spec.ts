import { expect, type Locator, type Page, test } from "@playwright/test";

import {
  contrastRatio,
  expectNoSeriousA11yViolations,
  openToolbarTestDoc,
  resolveRgb,
  setTheme,
} from "./helpers/a11y";
import { getPlaywrightModifierKey } from "./helpers/playwright-modifier-key";

/** A row button: a text selection also shows the bubble's B · I · U. */
const toolbarButton = (page: Page, name: string) =>
  page
    .getByRole("toolbar", { name: "Formatting", exact: true })
    .getByRole("button", { name, exact: true });

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

  test(`pressed state has a short centred underline at >=3:1 (${theme})`, async ({
    page,
  }) => {
    await setTheme(page, theme);
    await openToolbarTestDoc(page);
    const bold = await makeBoldPressed(page);
    const style = await bold.evaluate((el) => {
      const after = getComputedStyle(el, "::after");
      const own = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      const bar = el.closest("[role=toolbar]") as Element;
      return {
        underline: after.backgroundColor,
        width: Number.parseFloat(after.width),
        height: Number.parseFloat(after.height),
        left: Number.parseFloat(after.left),
        boxWidth: box.width,
        fill: own.backgroundColor,
        barBg: getComputedStyle(bar).backgroundColor,
      };
    });
    expect(style.width).toBeLessThanOrEqual(16);
    expect(style.height).toBe(2);
    // left:50% plus translateX(-50%) centres it; 50% of the box is the offset.
    expect(Math.abs(style.left - style.boxWidth / 2)).toBeLessThanOrEqual(1);
    // The data-active tint is translucent, so composite it over the toolbar.
    const bg = await page.evaluate(
      ({ barBg, fill }) => {
        const ctx = document.createElement("canvas").getContext("2d", {
          willReadFrequently: true,
        }) as CanvasRenderingContext2D;
        ctx.fillStyle = barBg;
        ctx.fillRect(0, 0, 1, 1);
        ctx.fillStyle = fill;
        ctx.fillRect(0, 0, 1, 1);
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
        return [r, g, b] as [number, number, number];
      },
      { barBg: style.barBg, fill: style.fill },
    );
    expect(
      contrastRatio(await resolveRgb(page, style.underline), bg),
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

/** D2's colour split: the chevron opens the colour popover (spec §4.5). */
const highlightTrigger = (page: Page) =>
  page
    .getByRole("toolbar")
    .getByRole("button", { name: "More highlight colours" });

/** The popover's Highlight row; Recent can repeat the same swatch names. */
const highlights = (dialog: Locator) =>
  dialog.getByRole("group", { name: "Highlight", exact: true });

async function openHighlightDialog(page: Page): Promise<Locator> {
  await highlightTrigger(page).click();
  const dialog = page.getByRole("dialog", { name: "Highlight colours" });
  await expect(highlights(dialog)).toBeVisible();
  return dialog;
}

test("highlight dialog: named swatches, focus on open, arrows move focus only", async ({
  page,
}) => {
  await openToolbarTestDoc(page);
  await selectWord(page);
  const trigger = highlightTrigger(page);
  await expect(trigger).not.toHaveAttribute("aria-pressed", /.*/);
  await expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
  const dialog = await openHighlightDialog(page);
  await expect(
    dialog.locator(
      '[role="menuitem"], [role="radiogroup"], [tabindex="0"]:not(button)',
    ),
  ).toHaveCount(0);
  // Nothing applied yet: focus starts on the pressed "No highlight".
  const none = highlights(dialog).getByRole("button", { name: "No highlight" });
  await expect(none).toBeFocused();
  await expect(none).toHaveAttribute("aria-pressed", "true");

  const before = await page.evaluate(() => window.__tiptap_editor?.getJSON());
  await page.keyboard.press("ArrowRight");
  await expect(
    highlights(dialog).getByRole("button", { name: "Gray highlight" }),
  ).toBeFocused();
  expect(await page.evaluate(() => window.__tiptap_editor?.getJSON())).toEqual(
    before,
  );

  // Arrows follow the token order (spec Appendix A).
  await page.keyboard.press("ArrowRight");
  await expect(
    highlights(dialog).getByRole("button", { name: "Brown highlight" }),
  ).toBeFocused();

  // Enter applies and keeps the popover open, focus on the swatch.
  const blue = highlights(dialog).getByRole("button", {
    name: "Blue highlight",
  });
  await blue.focus();
  await page.keyboard.press("Enter");
  await expect(blue).toHaveAttribute("aria-pressed", "true");
  await expect(blue.locator("svg")).toHaveCount(1);
  await expect(dialog).toBeVisible();
  await expect(blue).toBeFocused();
  expect(
    await page.evaluate(
      () => window.__tiptap_editor?.getAttributes("highlight").color,
    ),
  ).toBe("blue");
  await expect(none).toHaveAttribute("aria-pressed", "false");

  // Esc returns focus to the trigger; reopening focuses the applied swatch.
  await closeWithEscape(page, dialog);
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(blue).toBeFocused();
  await expect(blue).toHaveAttribute("aria-pressed", "true");
  await closeWithEscape(page, dialog);
  await expect(trigger).toBeFocused();
});

test("highlight dialog: No highlight keeps focus, Esc returns it to the trigger", async ({
  page,
}) => {
  await openToolbarTestDoc(page);
  await selectWord(page);
  const dialog = await openHighlightDialog(page);
  const green = highlights(dialog).getByRole("button", {
    name: "Green highlight",
  });
  await green.focus();
  await page.keyboard.press("Enter");
  await expect(green).toHaveAttribute("aria-pressed", "true");
  await expect(green).toBeFocused();

  const none = highlights(dialog).getByRole("button", { name: "No highlight" });
  await none.focus();
  await page.keyboard.press("Enter");
  await expect(green).toHaveAttribute("aria-pressed", "false");
  await expect(none).toHaveAttribute("aria-pressed", "true");
  expect(
    await page.evaluate(() => window.__tiptap_editor?.isActive("highlight")),
  ).toBe(false);
  await expect(none).toBeFocused();
  await closeWithEscape(page, dialog);
  await expect(highlightTrigger(page)).toBeFocused();
});

test("highlight dialog: a Mod-Shift-H highlight shows as the pressed Yellow swatch", async ({
  page,
}) => {
  await openToolbarTestDoc(page);
  await selectWord(page);
  await page.keyboard.press(`${getPlaywrightModifierKey()}+Shift+KeyH`);
  // Stored as the bare token.
  expect(
    await page.evaluate(
      () => window.__tiptap_editor?.getAttributes("highlight").color,
    ),
  ).toBe("yellow");

  const dialog = await openHighlightDialog(page);
  const yellow = highlights(dialog).getByRole("button", {
    name: "Yellow highlight",
  });
  await expect(yellow).toHaveAttribute("aria-pressed", "true");
  await expect(yellow.locator("svg")).toHaveCount(1);
  await expect(
    highlights(dialog).getByRole("button", { name: "Green highlight" }),
  ).toHaveAttribute("aria-pressed", "false");
  await closeWithEscape(page, dialog);
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

    const dialog = await openHighlightDialog(page);
    for (const name of SWATCHES) {
      const swatch = highlights(dialog).getByRole("button", {
        name: `${name} highlight`,
      });
      await swatch.click();
      await expect(swatch).toHaveAttribute("aria-pressed", "true");
      // PR A's per-swatch forced-colours check, on D2's swatch: forced
      // colours keep the swatch's own colour and outline it in a system
      // colour; elsewhere the theme decides.
      const border = await swatch.evaluate((el) => {
        const cs = getComputedStyle(el);
        const probe = document.createElement("div");
        probe.style.color = "ButtonText";
        document.body.appendChild(probe);
        const system = getComputedStyle(probe).color;
        probe.remove();
        return {
          adjust: cs.forcedColorAdjust,
          width: cs.borderTopWidth,
          color: cs.borderTopColor,
          system,
        };
      });
      expect(border.adjust, `${name} forced-color-adjust`).toBe(
        forced ? "none" : "auto",
      );
      expect(border.width, `${name} border`).toBe("1px");
      if (forced) {
        expect(border.color, `${name} border in ButtonText`).toBe(
          border.system,
        );
      }
      const check = await swatch.locator(".st-swatch-check").evaluate((el) => {
        const cs = getComputedStyle(el);
        return { color: cs.color, bg: cs.backgroundColor };
      });
      // The check sits on its own badge, so it reads on every swatch colour.
      expect(
        contrastRatio(
          await resolveRgb(page, check.color),
          await resolveRgb(page, check.bg),
        ),
        `${name} check on its badge`,
      ).toBeGreaterThanOrEqual(3);
    }

    await dialog.screenshot({
      path: testInfo.outputPath(`highlight-dialog-${mode.split(" ")[0]}.png`),
    });
    await closeWithEscape(page, dialog);
  });
}

const SCREENS = ".superpowers/screens-r2-popover";

/**
 * O3 (Appendix A): with teal text selected, a highlight that puts it below
 * 4.5:1 is dimmed and described "Low contrast" but still applies. Only
 * highlight swatches dim: the text row never does, even on a highlight.
 */
const LOW_CONTRAST_CASES = {
  // Teal on gray is below AA in light only; teal on yellow in dark only.
  light: { low: "Gray", ok: "Yellow" },
  dark: { low: "Yellow", ok: "Gray" },
} as const;

for (const mode of ["light", "dark", "forced colours"] as const) {
  test(`colour popover dims low-contrast swatches, still selectable (${mode})`, async ({
    page,
  }) => {
    const forced = mode === "forced colours";
    const theme = forced ? "light" : mode;
    if (forced) await page.emulateMedia({ forcedColors: "active" });
    await setTheme(page, theme);
    await openToolbarTestDoc(page);
    await selectWord(page);
    await page.evaluate(() =>
      window.__tiptap_editor?.commands.setTextColor("teal"),
    );

    const dialog = await openHighlightDialog(page);
    const { low, ok } = LOW_CONTRAST_CASES[theme];
    const dimmed = highlights(dialog).getByRole("button", {
      name: `${low} highlight`,
    });
    const clear = highlights(dialog).getByRole("button", {
      name: `${ok} highlight`,
    });
    await expect(dimmed).toHaveAttribute("data-low-contrast", "");
    await expect(dimmed).toHaveAccessibleDescription(
      "Low contrast with the current text colour",
    );
    await expect(dimmed).not.toHaveAttribute("aria-disabled", /.*/);
    await expect(clear).not.toHaveAttribute("data-low-contrast", /.*/);
    await expect(clear).not.toHaveAccessibleDescription(/Low contrast/);
    // Default text and "No highlight" never dim.
    await expect(
      highlights(dialog).getByRole("button", { name: "No highlight" }),
    ).not.toHaveAttribute("data-low-contrast", /.*/);

    const style = await dimmed.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        opacity: Number(cs.opacity),
        borderStyle: cs.borderTopStyle,
        borderWidth: cs.borderTopWidth,
      };
    });
    expect(style.opacity).toBeLessThan(1);
    // Not colour-only: a dotted border, also in forced colours.
    expect(style.borderStyle).toBe("dotted");
    expect(style.borderWidth).toBe("1px");

    // Dimming must not fade the focus ring: opacity also paints the
    // outline, so composite it at the swatch's opacity over the popover.
    await page.keyboard.press("Shift");
    await dimmed.focus();
    const ring = await dimmed.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        focusVisible: el.matches(":focus-visible"),
        outline: cs.outlineColor,
        opacity: Number(cs.opacity),
        bg: getComputedStyle(el.closest("[role=dialog]") as Element)
          .backgroundColor,
      };
    });
    expect(ring.focusVisible).toBe(true);
    const ringRgb = await page.evaluate(({ outline, opacity, bg }) => {
      const ctx = document.createElement("canvas").getContext("2d", {
        willReadFrequently: true,
      }) as CanvasRenderingContext2D;
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, 1, 1);
      ctx.globalAlpha = opacity;
      ctx.fillStyle = outline;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      return [r, g, b] as [number, number, number];
    }, ring);
    expect(
      contrastRatio(ringRgb, await resolveRgb(page, ring.bg)),
      "focus ring on a dimmed swatch",
    ).toBeGreaterThanOrEqual(3);

    await expectNoSeriousA11yViolations(page, [
      '[role="dialog"][aria-label="Highlight colours"]',
    ]);
    if (!forced) {
      await dialog.screenshot({
        path: `${SCREENS}/colour-low-contrast-${theme}.png`,
      });
    }

    // Still selectable: it applies and the popover stays open. The text
    // row stays undimmed although teal is now below AA on this highlight.
    await dimmed.click();
    await expect(dimmed).toHaveAttribute("aria-pressed", "true");
    expect(
      await page.evaluate(
        () => window.__tiptap_editor?.getAttributes("highlight").color,
      ),
    ).toBe(low.toLowerCase());
    const teal = dialog
      .getByRole("group", { name: "Text colour", exact: true })
      .getByRole("button", { name: "Teal text" });
    await expect(teal).not.toHaveAttribute("data-low-contrast", /.*/);
    await expect(teal).not.toHaveAccessibleDescription(/Low contrast/);
    await expect(
      dialog
        .getByRole("group", { name: "Text colour", exact: true })
        .getByRole("button", { name: "Default text" }),
    ).not.toHaveAttribute("data-low-contrast", /.*/);
    await closeWithEscape(page, dialog);
  });
}

test("phone format sheet colours: one arrow press moves one swatch", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openToolbarTestDoc(page);
  await selectWord(page);
  await page
    .getByRole("toolbar")
    .getByRole("button", { name: "Text format" })
    .click();

  const dialog = page.getByRole("dialog", { name: "Text format" });
  const group = dialog.getByRole("group", { name: "Highlight" });
  await expect(group).toBeVisible();
  const green = group.getByRole("button", { name: "Green highlight" });
  await green.focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    group.getByRole("button", { name: "Teal highlight" }),
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
    await openHighlightDialog(page);
    return;
  }
  const menus = toolbar.locator('button[aria-haspopup="menu"]:visible');
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

test("crossing 768px keeps focus in the toolbar that replaces the other", async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await openToolbarTestDoc(page);
  await page.addStyleTag({
    content: "nextjs-portal { display: none !important; }",
  });
  // Into the row on its tab stop, then five items along. (Not Alt+F10:
  // at T4 it can land on View ▾ and the next arrow drops to the editor,
  // a ladder issue that predates the phone bar.)
  await page
    .getByRole("toolbar", { name: "Formatting" })
    .getByRole("button", { name: "Undo" })
    .focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight");
  const inToolbar = () =>
    page.evaluate(() => {
      const active = document.activeElement;
      const toolbar = active?.closest('[role="toolbar"]');
      return toolbar ? (toolbar.getAttribute("data-variant") ?? "") : null;
    });
  expect(await inToolbar()).not.toBeNull();

  await page.setViewportSize({ width: 700, height: 900 });
  await expect(page.locator("[data-mobile-bar]")).toBeVisible();
  await expect.poll(inToolbar).toBe("docked");

  // And back: the row takes it, on the same action when it shows one.
  await page.keyboard.press("ArrowLeft");
  const id = await page.evaluate(
    () =>
      document.activeElement
        ?.closest<HTMLElement>("[data-action-id]")
        ?.getAttribute("data-action-id") ?? null,
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator("[data-mobile-bar]")).toHaveCount(0);
  await expect.poll(inToolbar).toBe("fixed");
  if (id) {
    await expect(
      page.locator(`[role="toolbar"] [data-action-id="${id}"]`).first(),
    ).toBeFocused();
  }
});
