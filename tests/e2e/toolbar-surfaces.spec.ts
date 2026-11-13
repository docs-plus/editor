/**
 * PR D2 surfaces: colour popover + split faces (M1–M3), size stepper, the
 * phone "Text format" sheet, outline memory (M6) and the memory kill
 * switch. Row cases run at desktop width, where the row holds the colour
 * pair and the stepper; phones reach them through the sheet
 * (`mobile-bar.spec.ts` covers the bar itself).
 */
import { expect, type Page, test } from "@playwright/test";

import {
  expectNoSeriousA11yViolations,
  openToolbarTestDoc,
  setTheme,
} from "./helpers/a11y";

/** Wide enough for the T1 row: colour pair and stepper in place. */
const DESKTOP = { width: 1440, height: 900 };
/** A small touch phone: coarse pointer, 360px wide. */
const TOUCH_PHONE = { width: 360, height: 740 };
const SCREENS = ".superpowers/screens-D2";
/** Phone-track evidence (spec §4.7): light, dark and forced colours. */
const PHONE_SCREENS = ".superpowers/screens-r2-phone";
/** The narrowest common phone (iPhone SE / mini class). */
const PHONE_375 = { width: 375, height: 812 };

async function selectNewParagraph(page: Page, text = "colour me") {
  await page.evaluate((value) => {
    const editor = window.__tiptap_editor;
    if (!editor) throw new Error("editor missing");
    const end = editor.state.doc.content.size;
    editor
      .chain()
      .focus()
      .insertContentAt(end, {
        type: "paragraph",
        content: [{ type: "text", text: value }],
      })
      .run();
    const to = editor.state.doc.content.size - 1;
    editor
      .chain()
      .focus()
      .setTextSelection({ from: to - value.length, to })
      .run();
  }, text);
}

/** Highlight token on the last paragraph's text, or null. */
const lastHighlight = (page: Page) =>
  page.evaluate(() => {
    const doc = window.__tiptap_editor?.state.doc;
    const mark = doc?.lastChild?.firstChild?.marks.find(
      (m) => m.type.name === "highlight",
    );
    return (mark?.attrs.color as string | undefined) ?? null;
  });

/** Opens a doc at desktop width with a fresh paragraph selected. */
async function openRow(page: Page) {
  await page.setViewportSize(DESKTOP);
  await openToolbarTestDoc(page);
  await selectNewParagraph(page);
}

/**
 * Inside a touch phone context: selects a fresh paragraph and taps Aa,
 * the docked bar's "Text format" sheet (spec §4.7).
 */
async function openPhoneSheet(page: Page) {
  await openToolbarTestDoc(page);
  await selectNewParagraph(page);
  await page
    .getByRole("toolbar")
    .getByRole("button", { name: "Text format" })
    .tap();
  const sheet = page.getByRole("dialog", { name: "Text format" });
  await sheet.getByRole("group", { name: "Text colour" }).waitFor();
  await sheet.evaluate((el) =>
    Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)),
  );
  return sheet;
}

const toolbar = (page: Page) => page.getByRole("toolbar");

/** Every visible control in `scope` with its box, for the 44px rule. */
const smallTargets = (page: Page, selector: string) =>
  page.locator(selector).evaluateAll((els) =>
    els
      .filter((el) => (el as HTMLElement).offsetParent !== null)
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

test("the row reaches text colour, highlight and size", async ({ page }) => {
  await openRow(page);
  await expect(
    toolbar(page).getByRole("button", { name: /^Apply text colour: / }),
  ).toBeVisible();
  await expect(
    toolbar(page).getByRole("button", { name: /^Apply highlight: / }),
  ).toBeVisible();
  await expect(
    toolbar(page).getByRole("spinbutton", { name: "Font size" }),
  ).toBeVisible();
});

test("highlight popover applies a token, remembers it and lists it as recent", async ({
  page,
}) => {
  await openRow(page);
  await toolbar(page)
    .getByRole("button", { name: "More highlight colours" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Highlight colours" });
  // Named aria-pressed buttons, no radiogroup (spec §4.5, a11y #3).
  await expect(dialog.getByRole("radiogroup")).toHaveCount(0);
  const blue = dialog.getByRole("button", { name: "Blue highlight" });
  await expect(blue).toHaveAttribute("aria-pressed", "false");
  await expect(blue).not.toHaveAttribute("aria-disabled", "true");
  // PR C registers the text colour mark, so its swatches are live here.
  const red = dialog
    .getByRole("group", { name: "Text colour" })
    .getByRole("button", { name: "Red text" });
  await expect(red).not.toHaveAttribute("aria-disabled", "true");
  // Arrow keys move focus only: nothing is applied.
  await expect(
    dialog.getByRole("button", { name: "No highlight" }),
  ).toBeFocused();
  await page.keyboard.press("ArrowRight");
  expect(await lastHighlight(page)).toBeNull();
  // Applying keeps the popover open (spec §4.5, O4); Esc closes it.
  await blue.click();
  await expect(blue).toHaveAttribute("aria-pressed", "true");
  expect(await lastHighlight(page)).toBe("blue");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // M2: the face now names and reapplies blue.
  const face = toolbar(page).getByRole("button", {
    name: "Apply highlight: Blue",
  });
  await expect(face).toBeVisible();
  await page.evaluate(() => window.__tiptap_editor?.commands.unsetHighlight());
  expect(await lastHighlight(page)).toBeNull();
  await face.click();
  expect(await lastHighlight(page)).toBe("blue");

  // M3: Recent shows it on the next open; the memory survives a reload.
  await toolbar(page)
    .getByRole("button", { name: "More highlight colours" })
    .click();
  const recent = dialog.getByRole("group", { name: "Recent" });
  await expect(
    recent.getByRole("button", { name: "Blue highlight" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("group", { name: "Highlight" }).getByRole("button", {
      name: "Blue highlight",
    }),
  ).toHaveAttribute("aria-pressed", "true");
  await expectNoSeriousA11yViolations(page, [
    '[role="dialog"][aria-label="Highlight colours"]',
  ]);
  await page.keyboard.press("Escape");

  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("tinydocy-choices") ?? "null"),
  );
  expect(stored).toMatchObject({
    v: 1,
    slots: {
      highlight: { last: "blue" },
      recentColors: { recent: [{ kind: "highlight", token: "blue" }] },
    },
  });
});

test("size stepper is a named spinbutton, disabled with a reason in headings", async ({
  page,
}) => {
  await openRow(page);
  const spin = toolbar(page).getByRole("spinbutton", { name: "Font size" });
  await expect(spin).toHaveAttribute("aria-valuetext", /pixels|Mixed/);
  await page.evaluate(() =>
    window.__tiptap_editor?.chain().focus().setTextSelection(1).run(),
  );
  await expect(spin).toHaveAttribute("aria-disabled", "true");
  const reasonId = await spin.getAttribute("aria-describedby");
  expect(reasonId).toBeTruthy();
  await expect(page.locator(`[id="${reasonId}"]`)).toHaveText(
    "Headings scale automatically.",
  );
});

test("size spinbutton keeps Home, End and Enter from the toolbar", async ({
  page,
}) => {
  await openRow(page);
  const spin = toolbar(page).getByRole("spinbutton", { name: "Font size" });
  const decrease = toolbar(page).getByRole("button", {
    name: "Decrease font size",
  });
  // Rove left to − so the toolbar's roving index points at it…
  await spin.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(decrease).toBeFocused();
  // …then click into the spinbutton: Enter must not click −.
  await spin.click({ force: true });
  await expect(spin).toBeFocused();
  const before = await spin.getAttribute("aria-valuetext");
  await page.keyboard.press("Enter");
  await expect(spin).toBeFocused();
  await expect(spin).toHaveAttribute("aria-valuetext", before ?? "");
  for (const key of ["Home", "End", "ArrowUp", "ArrowDown"]) {
    await page.keyboard.press(key);
    await expect(spin, `${key} keeps focus`).toBeFocused();
  }
  // ←/→ still rove.
  await page.keyboard.press("ArrowRight");
  await expect(
    toolbar(page).getByRole("button", { name: "Increase font size" }),
  ).toBeFocused();
});

test("colour swatches keep their colours in forced colours", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ forcedColors: "active" });
  await openRow(page);
  const more = toolbar(page).getByRole("button", {
    name: "More highlight colours",
  });
  await more.click();
  const dialog = page.getByRole("dialog", { name: "Highlight colours" });
  await dialog.getByRole("button", { name: "Blue highlight" }).click();
  const highlights = dialog.getByRole("group", { name: "Highlight" });
  const blue = highlights.getByRole("button", { name: "Blue highlight" });
  await expect(blue).toHaveAttribute("aria-pressed", "true");
  const styles = await highlights.getByRole("button").evaluateAll((els) =>
    els.map((el) => {
      const cs = getComputedStyle(el);
      return {
        token: el.getAttribute("data-token"),
        adjust: cs.forcedColorAdjust,
        bg: cs.backgroundColor,
        shadow: cs.boxShadow,
      };
    }),
  );
  for (const style of styles) expect(style.adjust).toBe("none");
  // Each highlight swatch shows its own colour.
  const colours = new Set(
    styles.filter((style) => style.token !== "none").map((style) => style.bg),
  );
  expect(colours.size).toBe(styles.length - 1);
  // Pressed is a ring, not the focus outline, and keeps the swatch's own
  // fill (the global forced-colours rule paints pressed buttons Highlight).
  const pressed = styles.find((style) => style.token === "blue");
  expect(pressed?.shadow).not.toBe("none");
  const systemHighlight = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.background = "Highlight";
    document.body.appendChild(probe);
    const colour = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return colour;
  });
  expect(pressed?.bg).not.toBe(systemHighlight);
  const face = await toolbar(page)
    .locator(".st-face-bar--highlight")
    .evaluate((el) => getComputedStyle(el).forcedColorAdjust);
  expect(face).toBe("none");
  await page.mouse.move(0, DESKTOP.height - 1);
  await testInfo.attach("colour-popover-forced-colors", {
    body: await dialog.screenshot(),
    contentType: "image/png",
  });
  await dialog.screenshot({
    path: `${SCREENS}/row-colour-popover-forced.png`,
  });
});

test("tampered memory falls back to defaults without errors", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem(
      "tinydocy-choices",
      JSON.stringify({
        v: 1,
        slots: {
          highlight: { last: "url(javascript:alert(1))" },
          recentColors: { recent: [{ kind: "highlight", token: "<img>" }, 7] },
          __proto__: { polluted: true },
        },
      }),
    );
  });
  await openRow(page);
  await expect(
    toolbar(page).getByRole("button", { name: "Apply highlight: Yellow" }),
  ).toBeVisible();
  await toolbar(page)
    .getByRole("button", { name: "More highlight colours" })
    .click();
  await expect(
    page.getByRole("dialog").getByRole("group", { name: "Recent" }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("outline open state survives a reload (M6) and Forget keeps it", async ({
  page,
}) => {
  await openToolbarTestDoc(page);
  const outline = page.locator(".toc-sidebar");
  await expect(outline).toBeVisible();
  await page.getByRole("button", { name: "Toggle outline" }).click();
  await expect(outline).toBeHidden();
  await page.evaluate(() => localStorage.removeItem("tinydocy-choices"));
  await page.reload();
  await page.locator('[data-server-synced="true"]').waitFor();
  await expect(outline).toBeHidden();
  await page.getByRole("button", { name: "Toggle outline" }).click();
  await expect(outline).toBeVisible();
});

for (const theme of ["light", "dark"] as const) {
  test(`screenshots of the row colour popover (${theme})`, async ({ page }) => {
    await setTheme(page, theme);
    await openRow(page);
    await toolbar(page)
      .getByRole("button", { name: "More highlight colours" })
      .click();
    const dialog = page.getByRole("dialog", { name: "Highlight colours" });
    await expect(
      dialog.getByRole("button", { name: "Red text" }),
    ).toBeVisible();
    await page.mouse.move(0, DESKTOP.height - 1);
    await dialog.evaluate((el) =>
      Promise.all(
        el
          .getAnimations({ subtree: true })
          .map((animation) => animation.finished),
      ),
    );
    await page.screenshot({
      path: `${SCREENS}/row-colour-popover-${theme}.png`,
    });
    // The floating popover must not clip the 2px focus outline.
    const focused = dialog.locator("button:focus-visible");
    if ((await focused.count()) > 0) {
      const clipped = await focused.evaluate((el) => {
        const popup = el.closest('[role="dialog"]') as HTMLElement;
        const a = el.getBoundingClientRect();
        const b = popup.getBoundingClientRect();
        return a.left - 4 < b.left || a.right + 4 > b.right;
      });
      expect(clipped).toBe(false);
    }
    await page.keyboard.press("Escape");
  });
}

test.describe("on a touch phone (coarse pointer, 360px)", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: TOUCH_PHONE });

  test("the sheet's colours fit with 44×44 swatches in lines of six", async ({
    page,
  }) => {
    expect(
      await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
    ).toBe(true);
    const sheet = await openPhoneSheet(page);
    expect(
      await smallTargets(
        page,
        '[data-format-sheet] button, [data-format-sheet] [role="spinbutton"]',
      ),
    ).toEqual([]);
    const box = await sheet.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(TOUCH_PHONE.width);
    }
    expect(
      await sheet.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `${SCREENS}/touch-phone-sheet.png` });

    // ↑/↓ follow the visual lines of six swatches.
    const highlights = sheet.getByRole("group", { name: "Highlight" });
    const none = highlights.getByRole("button", { name: "No highlight" });
    await none.focus();
    await page.keyboard.press("ArrowDown");
    await expect(highlights.locator('[data-col="6"]')).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(none).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(
      sheet
        .getByRole("group", { name: "Text colour" })
        .locator('[data-col="6"]'),
    ).toBeFocused();
  });
});

/**
 * v1 phone minimum (contract §1.3, D2 KEEP), moved from the old panel to
 * the docked bar's "Text format" sheet: at 375px on touch, text colour,
 * highlight and size apply with 44×44 targets in light, dark and forced
 * colours, and the stepper shows the applied size.
 */
test.describe("on a 375px touch phone", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: PHONE_375 });

  /** Mark attribute on the last paragraph's text, or null. */
  const lastMark = (page: Page, mark: string, attr: string) =>
    page.evaluate(
      ([name, key]) => {
        const doc = window.__tiptap_editor?.state.doc;
        const found = doc?.lastChild?.firstChild?.marks.find(
          (m) => m.type.name === name,
        );
        return (found?.attrs[key] as string | undefined) ?? null;
      },
      [mark, attr] as const,
    );

  for (const mode of ["light", "dark", "forced"] as const) {
    test(`colour and size apply from the sheet with 44×44 targets (${mode})`, async ({
      page,
    }) => {
      if (mode === "forced")
        await page.emulateMedia({ forcedColors: "active" });
      else await setTheme(page, mode);
      const sheet = await openPhoneSheet(page);

      expect(
        await smallTargets(
          page,
          '[data-format-sheet] button, [data-format-sheet] [role="spinbutton"], [role="toolbar"] button',
        ),
      ).toEqual([]);
      expect(
        await sheet.evaluate((el) => el.scrollWidth - el.clientWidth),
      ).toBeLessThanOrEqual(1);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        ),
      ).toBeLessThanOrEqual(0);
      await expectNoSeriousA11yViolations(page, [
        '[role="toolbar"]',
        "[data-format-sheet]",
      ]);

      await sheet.getByRole("button", { name: "Red text" }).tap();
      await sheet.getByRole("button", { name: "Yellow highlight" }).tap();
      await sheet.getByRole("button", { name: "Increase font size" }).tap();
      await expect.poll(() => lastMark(page, "textColor", "color")).toBe("red");
      await expect.poll(() => lastHighlight(page)).toBe("yellow");
      await expect.poll(() => lastMark(page, "fontSize", "size")).toBe("lg");
      // What is on screen and exposed to assistive tech follows the mark
      // (WCAG 4.1.2); this also waits out the toolbar settle delay.
      const stepper = sheet.getByRole("spinbutton", { name: "Font size" });
      await expect(stepper).toHaveAttribute("aria-valuetext", /^Large/);
      await expect(stepper).toHaveText("L");
      await expect(
        sheet
          .getByRole("group", { name: "Highlight" })
          .getByRole("button", { name: "Yellow highlight" }),
      ).toHaveAttribute("aria-pressed", "true");

      await page.screenshot({
        path: `${PHONE_SCREENS}/sheet-375-${mode}.png`,
      });
    });
  }
});
